// Lightweight, no-external-deps chart primitives shared across admin dashboard
// panels (Overview's Financial Composition, Game Transactions' new dashboard).
// Kept in their own file so panels in different components can both import
// them without creating a circular import between admin pages.

import { formatCredits } from '../store/useStore';

/** Lightweight SVG donut chart — no external deps. */
export function Donut({
  segments,
  size = 150,
  thickness = 22,
}: {
  segments: Array<{ label: string; value: number; color: string }>;
  size?: number;
  thickness?: number;
}) {
  const total = segments.reduce((s, x) => s + Math.max(0, x.value), 0);
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="adm-donut">
      <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="rgba(255,255,255,0.05)"
          strokeWidth={thickness}
        />
        {total > 0 &&
          segments.map((seg, i) => {
            const frac = Math.max(0, seg.value) / total;
            const dash = frac * c;
            const el = (
              <circle
                key={i}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={seg.color}
                strokeWidth={thickness}
                strokeDasharray={`${dash} ${c - dash}`}
                strokeDashoffset={-offset}
              />
            );
            offset += dash;
            return el;
          })}
      </g>
      <text
        x="50%"
        y="47%"
        textAnchor="middle"
        fontSize="11"
        fill="var(--text-muted)"
        fontWeight="700"
        style={{ textTransform: 'uppercase', letterSpacing: '0.5px' }}
      >
        Total
      </text>
      <text
        x="50%"
        y="62%"
        textAnchor="middle"
        fontSize="15"
        fill="var(--text-primary)"
        fontWeight="800"
        fontFamily="var(--font-display)"
      >
        {formatCredits(total)}
      </text>
    </svg>
  );
}

export function Bar({
  value,
  max,
  color = '#3b82f6',
}: {
  value: number;
  max: number;
  color?: string;
}) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="adm-bar">
      <div className="adm-bar-fill" style={{ width: `${pct.toFixed(1)}%`, background: color }} />
    </div>
  );
}

/**
 * Compact grouped mini bar chart for trends (e.g. per-day or per-room series).
 * Deliberately not a line chart — bars are simpler to hand-roll correctly
 * (no path/curve math) and match this admin panel's existing bar-based style.
 */
export function MiniTrendChart({
  data,
  height = 110,
}: {
  data: Array<{ label: string; series: Array<{ value: number; color: string; title: string }> }>;
  height?: number;
}) {
  const maxVal = Math.max(1, ...data.flatMap((d) => d.series.map((s) => s.value)));
  const barAreaHeight = height - 26;
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height, overflowX: 'auto', padding: '4px 2px' }}>
      {data.map((d, i) => (
        <div
          key={i}
          style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, flexShrink: 0 }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: barAreaHeight }}>
            {d.series.map((s, j) => (
              <div
                key={j}
                title={s.title}
                style={{
                  width: 9,
                  height: `${Math.max(2, (s.value / maxVal) * 100)}%`,
                  background: s.color,
                  borderRadius: 2,
                }}
              />
            ))}
          </div>
          <span style={{ fontSize: 9, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{d.label}</span>
        </div>
      ))}
    </div>
  );
}
