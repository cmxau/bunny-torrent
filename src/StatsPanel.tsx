import { fmtBytes, fmtSpeed, fmtTime, type Torrent } from "./api";
import { Chart } from "./ui";

export type Series = { d: boolean; u: boolean };

/** Global transfer graph and totals, shown below the list when no torrent is selected. */
export function StatsPanel({
  torrents,
  hist,
  series,
  setSeries,
  started,
}: {
  torrents: Torrent[];
  hist: { d: number[]; u: number[] };
  series: Series;
  setSeries: (s: Series) => void;
  started: number;
}) {
  const totDown = torrents.reduce((a, t) => a + t.downloadedBytes, 0);
  const totUp = torrents.reduce((a, t) => a + t.uploadedBytes, 0);
  const curD = hist.d[hist.d.length - 1];
  const curU = hist.u[hist.u.length - 1];
  const downloading = torrents.filter((t) => t.state === "downloading");
  const eta = downloading.length ? Math.max(...downloading.map((t) => t.etaSecs ?? 0)) : null;
  const peersSum = torrents.reduce((a, t) => a + t.peers, 0);

  return (
    <section className="stats">
      <div className="chartwrap">
        <div className="charthead">
          <span className="cap">TRANSFER SPEED</span>
          <div className="seg">
            <button className={series.d ? "on" : ""} onClick={() => setSeries({ ...series, d: !series.d })}>
              <i className="sw d" /> DOWNLOAD
            </button>
            <button className={series.u ? "on" : ""} onClick={() => setSeries({ ...series, u: !series.u })}>
              <i className="sw u" /> UPLOAD
            </button>
          </div>
        </div>
        <Chart d={series.d ? hist.d : null} u={series.u ? hist.u : null} />
      </div>
      <div className="nums">
        <span className="cap">DOWNLOAD / UPLOAD PER SEC</span>
        <div className="speeds">
          <span>↓ {fmtSpeed(curD)}</span>
          <span>↑ {fmtSpeed(curU)}</span>
        </div>
        <div className="grid">
          <Stat l="Connected peers" v={String(peersSum)} />
          <Stat l="Down / up ratio" v={totDown ? (totUp / totDown).toFixed(1) : "0"} />
          <Stat l="Downloaded" v={fmtBytes(totDown)} />
          <Stat l="Uploaded" v={fmtBytes(totUp)} />
          <Stat l="Time elapsed" v={fmtTime(Math.floor((Date.now() - started) / 1000))} />
          <Stat l="Time left" v={fmtTime(eta)} />
        </div>
      </div>
    </section>
  );
}

function Stat({ l, v }: { l: string; v: string }) {
  return (
    <div className="stat">
      <small>{l}</small>
      <b>{v}</b>
    </div>
  );
}
