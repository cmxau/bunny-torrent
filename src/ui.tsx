import type { ReactNode } from "react";

export const P = {
  home: "M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  down: "M12 4v15m0 0-6-6m6 6 6-6",
  up: "M12 20V5m0 0-6 6m6-6 6 6",
  folder: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  sliders: "M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4",
  plus: "M12 5v14M5 12h14",
  pause: "M8 5v14M16 5v14",
  play: "M8 5v14l11-7z",
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
  chevR: "M9 6l6 6-6 6",
  close: "M6 6l12 12M18 6 6 18",
  list: "M4 6h16M4 12h16M4 18h16",
  upload: "M12 16V4m0 0-4 4m4-4 4 4M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3",
};

export const Icon = ({ d, size = 18 }: { d: string; size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d={d} />
  </svg>
);

/** The GitHub mark (filled, so it takes its colour from the text). */
export const GithubIcon = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.56v-2c-3.2.7-3.87-1.37-3.87-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.78 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.42-2.7 5.4-5.27 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5z" />
  </svg>
);

export function Toggle({
  on,
  onChange,
  label,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label?: string;
}) {
  return (
    <button
      className={`toggle ${on ? "on" : ""}`}
      onClick={() => onChange(!on)}
      role="switch"
      aria-checked={on}
      aria-label={label}
    >
      <span />
    </button>
  );
}

export function Ring({ pct }: { pct: number }) {
  const r = 16;
  const c = 2 * Math.PI * r;
  return (
    <svg className="ring" width="44" height="44" viewBox="0 0 44 44">
      <circle cx="22" cy="22" r={r} fill="none" stroke="currentColor" strokeOpacity=".15" strokeWidth="3" />
      <circle
        cx="22"
        cy="22"
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray={`${c * pct} ${c}`}
        transform="rotate(-90 22 22)"
      />
      <text x="22" y="26" textAnchor="middle" fontSize="11" fill="currentColor">
        {Math.round(pct * 100)}%
      </text>
    </svg>
  );
}

export function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="modalbg" onMouseDown={onClose}>
      <div
        className={`modal ${wide ? "wide" : ""}`}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={title}
      >
        <div className="mhead">
          <h3>{title}</h3>
          <button className="x" onClick={onClose} aria-label="Close">
            <Icon d={P.close} size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function smooth(pts: [number, number][]): string {
  if (pts.length < 2) return "";
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${p2[0]},${p2[1]}`;
  }
  return d;
}

export function Chart({ d, u }: { d: number[] | null; u: number[] | null }) {
  const W = 400;
  const H = 150;
  const pad = 14;
  const max = Math.max(1024 * 1024, ...(d ?? []), ...(u ?? [])) * 1.25;
  const build = (a: number[]) =>
    a.map((v, i): [number, number] => [(i / (a.length - 1)) * W, H - pad - (v / max) * (H - pad * 2)]);
  const layer = (a: number[] | null, cls: string) => {
    if (!a) return null;
    const pts = build(a);
    const line = smooth(pts);
    const last = pts[pts.length - 1];
    return (
      <g key={cls}>
        <path d={`${line} L${W},${H} L0,${H} Z`} fill={`url(#g-${cls})`} />
        <path d={line} className={`ln ${cls}`} fill="none" strokeWidth="1.6" />
        <circle cx={last[0] - 3} cy={last[1]} r="3.5" className={`dot ${cls}`} />
      </g>
    );
  };
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id="g-d" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--dl)" stopOpacity=".28" />
            <stop offset="1" stopColor="var(--dl)" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="g-u" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--ul)" stopOpacity=".22" />
            <stop offset="1" stopColor="var(--ul)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {layer(u, "u")}
        {layer(d, "d")}
      </svg>
    </div>
  );
}
