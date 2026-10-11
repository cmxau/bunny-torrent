//! Bandwidth schedule: pick the speed limits that apply right now.

use std::num::NonZeroU32;

use chrono::{Datelike, Local, Timelike};
use librqbit::Session;
use serde::{Deserialize, Serialize};

use crate::store::Settings;

#[derive(Serialize, Deserialize, Clone, Default, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct ScheduleRule {
    /// bit0 = Monday ... bit6 = Sunday
    pub days: u8,
    /// minutes since local midnight; `end_min < start_min` wraps past midnight
    pub start_min: u16,
    pub end_min: u16,
    /// KiB/s, 0 = unlimited during the window
    pub dl_limit_kib: u32,
    pub ul_limit_kib: u32,
}

fn has_day(days: u8, weekday: u8) -> bool {
    days & (1 << (weekday % 7)) != 0
}

/// `weekday`: 0 = Monday ... 6 = Sunday. The after-midnight part of a wrapping window belongs to
/// the day the window started on. `start == end` is an empty window.
pub fn rule_matches(r: &ScheduleRule, weekday: u8, minute: u16) -> bool {
    if r.start_min < r.end_min {
        has_day(r.days, weekday) && minute >= r.start_min && minute < r.end_min
    } else if r.start_min > r.end_min {
        (has_day(r.days, weekday) && minute >= r.start_min)
            || (has_day(r.days, (weekday + 6) % 7) && minute < r.end_min)
    } else {
        false
    }
}

/// (download KiB/s, upload KiB/s) in force at this moment; 0 = unlimited.
pub fn effective_limits(s: &Settings, weekday: u8, minute: u16) -> (u32, u32) {
    if s.schedule_enabled {
        if let Some(r) = s.schedule.iter().find(|r| rule_matches(r, weekday, minute)) {
            return (r.dl_limit_kib, r.ul_limit_kib);
        }
    }
    (s.dl_limit_kib, s.ul_limit_kib)
}

pub fn now_local() -> (u8, u16) {
    let n = Local::now();
    (n.weekday().num_days_from_monday() as u8, (n.hour() * 60 + n.minute()) as u16)
}

pub fn current_limits(s: &Settings) -> (u32, u32) {
    let (d, m) = now_local();
    effective_limits(s, d, m)
}

pub fn apply(session: &Session, (dl, ul): (u32, u32)) {
    let nz = |kib: u32| NonZeroU32::new(kib.saturating_mul(1024));
    session.ratelimits.set_download_bps(nz(dl));
    session.ratelimits.set_upload_bps(nz(ul));
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rule(days: u8, s: u16, e: u16) -> ScheduleRule {
        ScheduleRule { days, start_min: s, end_min: e, dl_limit_kib: 100, ul_limit_kib: 10 }
    }

    #[test]
    fn same_day_window_and_weekday_mask() {
        let r = rule(0b0000001, 9 * 60, 17 * 60); // Monday only
        assert!(rule_matches(&r, 0, 9 * 60));
        assert!(rule_matches(&r, 0, 17 * 60 - 1));
        assert!(!rule_matches(&r, 0, 17 * 60));
        assert!(!rule_matches(&r, 1, 12 * 60));
    }

    #[test]
    fn wraps_past_midnight() {
        let r = rule(0b0000001, 22 * 60, 6 * 60); // Monday night
        assert!(rule_matches(&r, 0, 23 * 60));
        assert!(!rule_matches(&r, 0, 3 * 60)); // Monday early morning belongs to Sunday night
        assert!(rule_matches(&r, 1, 3 * 60)); // Tuesday 03:00 is Monday's window
        assert!(!rule_matches(&r, 1, 23 * 60));
        let sun = rule(0b1000000, 22 * 60, 6 * 60);
        assert!(rule_matches(&sun, 0, 2 * 60)); // Sunday night runs into Monday
    }

    #[test]
    fn empty_window() {
        assert!(!rule_matches(&rule(0x7f, 100, 100), 3, 100));
    }

    #[test]
    fn effective_limits_pick_first_match_or_normal() {
        let mut s = Settings { dl_limit_kib: 500, ul_limit_kib: 50, ..Default::default() };
        s.schedule = vec![
            ScheduleRule { days: 0x7f, start_min: 0, end_min: 60, dl_limit_kib: 0, ul_limit_kib: 5 },
            rule(0x7f, 0, 120),
        ];
        assert_eq!(effective_limits(&s, 2, 30), (500, 50)); // disabled
        s.schedule_enabled = true;
        assert_eq!(effective_limits(&s, 2, 30), (0, 5)); // first rule wins
        assert_eq!(effective_limits(&s, 2, 90), (100, 10));
        assert_eq!(effective_limits(&s, 2, 600), (500, 50));
    }
}
