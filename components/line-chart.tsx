"use client";
import { useEffect, useId, useRef, useState } from "react";

/**
 * A small, dependency-free line chart following the dataviz rules:
 * one y-axis starting at zero, 2px lines, ≥8px markers with a surface ring, hairline grid,
 * a legend for 2+ series plus end labels when they don't collide, a crosshair tooltip that
 * lists every series at the hovered x (pointer, touch or arrow keys), and a table view.
 *
 * Values arrive pre-formatted from the server (money is integer cents there);
 * `y` numbers here only position marks on screen.
 */

export interface ChartPoint {
  x: number; // index into categories
  y: number; // in cents; used for positioning only
  label: string; // pre-formatted value for the tooltip
  note?: string; // optional detail line in the tooltip
}

export interface ChartSeries {
  key: string;
  name: string;
  color: string;
  kind: "line" | "markers";
  points: ChartPoint[];
}

export interface LineChartProps {
  title: string;
  categories: string[];
  series: ChartSeries[];
  table: { headers: string[]; rows: string[][] };
  height?: number;
}

const M = { top: 12, right: 16, bottom: 28, left: 56 };
const END_LABEL_SPACE = 72;

/** Tick step in cents: 1/2/5 × 10^k whole dollars, at most ~5 ticks. */
function niceTicks(max: number): number[] {
  if (max <= 0) return [0, 100];
  const raw = max / 4;
  const pow = 10 ** Math.floor(Math.log10(Math.max(raw, 100)));
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw && s >= 100) ?? pow * 10;
  const ticks: number[] = [];
  for (let t = 0; t <= max + step * 0.001; t += step) ticks.push(t);
  if (ticks[ticks.length - 1]! < max) ticks.push(ticks[ticks.length - 1]! + step);
  return ticks;
}

function dollars(cents: number): string {
  const d = Math.round(cents / 100);
  return d >= 10_000 ? `$${Math.round(d / 1000)}k` : `$${d.toLocaleString("en-CA")}`;
}

export function LineChart({ title, categories, series, table, height = 240 }: LineChartProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [active, setActive] = useState<number | null>(null);
  const id = useId();

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(280, Math.floor(e!.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const lines = series.filter((s) => s.kind === "line");
  const ends = lines.map((s) => s.points.at(-1)).filter((p): p is ChartPoint => !!p);
  const maxY = Math.max(0, ...series.flatMap((s) => s.points.map((p) => p.y)));
  const ticks = niceTicks(maxY);
  const top = ticks[ticks.length - 1]!;

  const plotH = height - M.top - M.bottom;
  const yOf = (v: number) => M.top + plotH - (v / top) * plotH;

  // End labels only when there's room and the line ends don't collide.
  const endYs = ends.map((p) => yOf(p.y));
  const endLabels = lines.length <= 4 && width >= 420 && endYs.every((y, i) => endYs.every((o, j) => i === j || Math.abs(y - o) >= 16));
  const right = M.right + (endLabels ? END_LABEL_SPACE : 0);
  const plotW = width - M.left - right;
  const n = categories.length;
  const xOf = (i: number) => (n <= 1 ? M.left + plotW / 2 : M.left + (i / (n - 1)) * plotW);

  function nearest(clientX: number) {
    const rect = wrap.current!.getBoundingClientRect();
    const x = clientX - rect.left;
    let best = 0;
    for (let i = 1; i < n; i++) if (Math.abs(xOf(i) - x) < Math.abs(xOf(best) - x)) best = i;
    setActive(best);
  }

  const rowsAt = (i: number) =>
    series.flatMap((s) => s.points.filter((p) => p.x === i).map((p) => ({ s, p })));

  // Thin out x labels on narrow screens.
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(plotW / 56))));

  return (
    <figure className="space-y-3">
      {series.length >= 2 && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-hidden>
          {series.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5">
              {s.kind === "line" ? (
                <svg width="16" height="8">
                  <line x1="1" y1="4" x2="15" y2="4" stroke={s.color} strokeWidth="2" strokeLinecap="round" />
                </svg>
              ) : (
                <svg width="10" height="10">
                  <circle cx="5" cy="5" r="4" fill={s.color} />
                </svg>
              )}
              {s.name}
            </li>
          ))}
        </ul>
      )}

      <div ref={wrap} className="relative select-none">
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`${title}. Use left and right arrow keys to read values.`}
          tabIndex={0}
          className="block touch-pan-y rounded outline-none focus-visible:ring-2 focus-visible:ring-ink/20"
          onPointerMove={(e) => nearest(e.clientX)}
          onPointerDown={(e) => nearest(e.clientX)}
          onPointerLeave={(e) => e.pointerType === "mouse" && setActive(null)}
          onFocus={() => setActive((a) => a ?? n - 1)}
          onBlur={() => setActive(null)}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") setActive((a) => Math.max(0, (a ?? n - 1) - 1));
            if (e.key === "ArrowRight") setActive((a) => Math.min(n - 1, (a ?? 0) + 1));
            if (e.key === "Escape") setActive(null);
          }}
        >
          {/* Grid and y-axis labels (recessive). */}
          {ticks.map((t) => (
            <g key={t}>
              <line x1={M.left} x2={width - right} y1={yOf(t)} y2={yOf(t)} stroke="var(--color-line)" strokeWidth="1" />
              <text x={M.left - 8} y={yOf(t)} dy="0.32em" textAnchor="end" className="fill-muted text-[11px] tabular-nums">
                {dollars(t)}
              </text>
            </g>
          ))}
          {categories.map((c, i) =>
            i % every === 0 || i === n - 1 ? (
              <text
                key={c}
                x={xOf(i)}
                y={height - 8}
                // Edge labels hug the plot edges so they're never clipped.
                textAnchor={n > 1 && i === 0 ? "start" : n > 1 && i === n - 1 ? "end" : "middle"}
                className="fill-muted text-[11px] tabular-nums"
              >
                {c}
              </text>
            ) : null,
          )}

          {active !== null && (
            <line x1={xOf(active)} x2={xOf(active)} y1={M.top} y2={M.top + plotH} stroke="var(--color-muted)" strokeWidth="1" />
          )}

          {lines.map((s) => (
            <g key={s.key}>
              {s.points.length > 1 && (
                <polyline
                  fill="none"
                  stroke={s.color}
                  strokeWidth="2"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  points={s.points.map((p) => `${xOf(p.x)},${yOf(p.y)}`).join(" ")}
                />
              )}
              {s.points.map((p) => (
                <circle
                  key={p.x}
                  cx={xOf(p.x)}
                  cy={yOf(p.y)}
                  r={active === p.x ? 5 : 3}
                  fill={s.color}
                  stroke="#ffffff"
                  strokeWidth="2"
                />
              ))}
            </g>
          ))}
          {series
            .filter((s) => s.kind === "markers")
            .map((s) =>
              s.points.map((p, k) => (
                <circle key={`${s.key}-${k}`} cx={xOf(p.x)} cy={yOf(p.y)} r={active === p.x ? 6 : 5} fill={s.color} stroke="#ffffff" strokeWidth="2" />
              )),
            )}

          {endLabels &&
            lines.map((s) => {
              const p = s.points.at(-1);
              return p ? (
                <text key={s.key} x={xOf(p.x) + 10} y={yOf(p.y)} dy="0.32em" className="fill-ink text-[11px] font-medium">
                  {s.name}
                </text>
              ) : null;
            })}
        </svg>

        {active !== null && rowsAt(active).length > 0 && (
          <div
            role="status"
            className="pointer-events-none absolute top-1 z-10 min-w-36 rounded-lg border border-line bg-white px-3 py-2 text-xs shadow-sm"
            style={xOf(active) > width / 2 ? { right: width - xOf(active) + 10 } : { left: xOf(active) + 10 }}
          >
            <div className="mb-1 font-medium text-muted">{categories[active]}</div>
            <ul className="space-y-1">
              {rowsAt(active).map(({ s, p }, k) => (
                <li key={`${s.key}-${k}`} className="flex items-start gap-2">
                  <svg width="12" height="10" className="mt-1 shrink-0" aria-hidden>
                    {s.kind === "line" ? (
                      <line x1="1" y1="5" x2="11" y2="5" stroke={s.color} strokeWidth="2" strokeLinecap="round" />
                    ) : (
                      <circle cx="6" cy="5" r="4" fill={s.color} />
                    )}
                  </svg>
                  <div>
                    <span className="font-semibold tabular-nums text-ink">{p.label}</span>{" "}
                    <span className="text-muted">{s.name}</span>
                    {p.note && <div className="text-muted">{p.note}</div>}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <details className="text-sm">
        <summary className="cursor-pointer text-xs text-muted">Show as table</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-sm" aria-describedby={id}>
            <caption id={id} className="sr-only">
              {title}
            </caption>
            <thead className="text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                {table.headers.map((h, i) => (
                  <th key={h} className={`py-1 pr-3 ${i > 0 ? "text-right" : ""}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r, i) => (
                <tr key={i} className="border-t border-line">
                  {r.map((c, j) => (
                    <td key={j} className={`py-1 pr-3 tabular-nums ${j > 0 ? "text-right" : ""}`}>
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
