import { DIM, DIMMER, HOVER, LINE, MUTED, RAISE, TEXT } from '@/ui/theme';
import { PLOT_VIEW } from '@engine/elements/widgets/plot_window/PlotWindowWidgetRunner.ts';

interface PlotWidgetProps {
  data: unknown;
  width?: number;
  height?: number;
}

interface PlotPoint {
  label: string;
  value: number;
}

/** The four shapes the app draws itself. Anything else is written as SVG by the block's own body. */
export type PlotKind = 'bars' | 'columns' | 'line' | 'donut';

/**
 * What arrived at a chart, once it is understood.
 *
 * A node produces one of these -- it is ordinary data -- and the app draws it
 * at the size the block is. That is the whole point of the shape: choosing
 * between bars and a donut is a *value*, so it can come down a wire from a
 * dropdown on the page, where writing SVG in a node could never follow.
 */
export interface Figure {
  kind: PlotKind;
  title: string;
  points: PlotPoint[];
}

const KINDS: PlotKind[] = ['bars', 'columns', 'line', 'donut'];

/** A series colour that survives a scheme change, with a fallback for the canvas preview, which is outside the page. */
const FALLBACK = ['#6366f1', '#22c55e', '#f59e0b', '#ec4899', '#06b6d4', '#a78bfa', '#84cc16', '#fb923c'];
const colour = (index: number) => `var(--plot-${(index % 8) + 1}, ${FALLBACK[index % 8]})`;

/** Coerce a list into `{label, value}` points, or `null` if it can't be charted. */
function toPoints(value: unknown): PlotPoint[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;

  const points: PlotPoint[] = [];
  for (let i = 0; i < value.length; i++) {
    const item = value[i];
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) return null;
      points.push({ label: String(i), value: item });
      continue;
    }
    if (item && typeof item === 'object') {
      const obj = item as Record<string, unknown>;
      const rawValue = obj.y ?? obj.value;
      const rawLabel = obj.x ?? obj.label ?? i;
      if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
        points.push({ label: String(rawLabel), value: rawValue });
        continue;
      }
    }
    return null;
  }
  return points;
}

/**
 * What a chart was handed, as a figure.
 *
 * Three shapes are accepted and they are not alternatives so much as a ladder.
 * A bare list of points is the old shape and still the shortest thing that
 * works. A `{kind, title, points}` object is the same list with the two
 * decisions a caller usually also has. Neither is SVG: a body that draws its
 * own is caught before this, by `asDrawing`.
 */
export function toFigure(data: unknown): Figure | null {
  let value = data;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }

  const listed = toPoints(value);
  if (listed) return { kind: listed.length > 12 ? 'line' : 'columns', title: '', points: listed };

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const object = value as Record<string, unknown>;
    const points = toPoints(object.points ?? object.values ?? object.data);
    if (!points) return null;
    const asked = String(object.kind ?? '').toLowerCase();
    const kind = KINDS.includes(asked as PlotKind) ? asked as PlotKind
      : points.length > 12 ? 'line' : 'columns';
    return { kind, title: String(object.title ?? ''), points };
  }
  return null;
}

/** Auto-scale a set of values to an axis range that always includes 0 (so the baseline stays on-chart for all-negative or all-positive data), guarding against a zero-size range. */
export function computeAxisRange(values: number[]): { min: number; max: number; range: number } {
  const max = Math.max(0, ...values);
  const min = Math.min(0, ...values);
  const range = max - min || Math.max(1, Math.abs(max) || 1);
  return { min, max: min + range, range };
}

/**
 * A number short enough to sit beside an axis: 1430000000 becomes 1.4G.
 *
 * An axis whose labels do not fit is an axis that hides the chart, and the
 * numbers plotted are often large.
 */
export function axisLabel(value: number): string {
  const abs = Math.abs(value);
  const units: [number, string][] = [[1e9, 'G'], [1e6, 'M'], [1e3, 'k']];
  for (const [size, suffix] of units) {
    if (abs >= size) {
      const scaled = value / size;
      return `${Math.abs(scaled) < 10 ? scaled.toFixed(1) : Math.round(scaled)}${suffix}`;
    }
  }
  if (abs === 0) return '0';
  if (abs < 1) return String(Number(value.toFixed(2)));
  return String(Math.round(value));
}

/**
 * Room for axes, in the block's own pixels, or the bare sparkline a canvas
 * preview has space for.
 *
 * The left margin grows with the numbers rather than staying at a constant:
 * `1.4G` and `128,500` do not need the same room, and an axis that guesses one
 * width for both either crops the long one or wastes the short one's space.
 */
export function chartMargins(width: number, height: number, longestLabel = 3) {
  const labelled = width >= 160 && height >= 80;
  if (!labelled) return { left: 6, right: 6, top: 6, bottom: 6, labelled };
  const forNumbers = Math.min(Math.round(width * 0.3), 12 + longestLabel * 7);
  return {
    ...PLOT_VIEW.margin,
    left: Math.max(PLOT_VIEW.margin.left, forNumbers),
    labelled,
  };
}

/** Keep a category label inside its slot rather than letting it overlap the next. */
function fit(label: string, slotWidth: number): string {
  const chars = Math.max(1, Math.floor(slotWidth / 6.2));
  return label.length <= chars ? label : `${label.slice(0, Math.max(1, chars - 1))}…`;
}

/**
 * Drawing the block's own body did itself.
 *
 * The four kinds below cover the ordinary case, and nothing beyond it: a
 * scatter, two series against each other, a legend of its own. Rather than
 * growing a chart library one option at a time, a body may return finished SVG
 * and this draws it -- so what can be plotted is whatever the body can write,
 * not whatever was foreseen here.
 *
 * Scripts and event handlers are stripped. The markup is generated locally by
 * code the person asked for, but it also travels inside a graph that may be
 * handed on, and "it came from our own AI" is not a reason to run whatever
 * arrives.
 */
export function asDrawing(data: unknown): string | null {
  if (typeof data !== 'string') return null;
  const text = data.trim();
  if (!/^<svg[\s>]/i.test(text)) return null;
  return text
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
    .replace(/javascript:/gi, '');
}

/**
 * A chart, dependency-free, drawn from a figure at the size the block is.
 *
 * It draws its own axes: a value scale and the category names. Without them
 * the bars were a block of colour that happened to have the right proportions
 * -- correct, and unreadable, which reads to whoever ran the graph as nothing
 * having happened.
 *
 * Every coordinate below is a screen pixel. There is no inner coordinate space
 * being scaled into the block any more, which is what used to make a label's
 * size depend on how big someone had dragged the window.
 */
export default function PlotChart({ data, width = 220, height = 90 }: PlotWidgetProps) {
  // Finished SVG wins: the body drew something this could not have.
  const drawing = asDrawing(data);
  if (drawing) {
    return (
      <div
        className="w-full h-full flex items-center justify-center overflow-hidden"
        style={{ background: RAISE, borderRadius: 4 }}
        // Set as HTML on purpose: stripped by asDrawing above
        dangerouslySetInnerHTML={{ __html: drawing }}
      />
    );
  }

  const figure = toFigure(data);

  // A string that is not a figure is worth showing verbatim: it is either the
  // raw value that arrived, or a "⚠ transform failed" message from the engine.
  const message = typeof data === 'string' ? data.trim() : '';
  if (!figure && message) {
    return (
      <div
        className="text-xs px-2 py-1.5 rounded whitespace-pre-wrap break-words"
        style={{ background: HOVER, color: DIM, maxHeight: 160, overflowY: 'auto' }}
      >
        {message}
      </div>
    );
  }

  const frame = { width: Math.max(1, width), height: Math.max(1, height) };
  const values = figure ? figure.points.map((p) => p.value) : [0, 1];
  const { min, max, range } = computeAxisRange(values);
  const widest = Math.max(...[max, min + range / 2, min].map((t) => axisLabel(t).length));
  const margin = chartMargins(frame.width, frame.height, widest);

  // The title is part of the drawing, not a label above it: a block may be
  // wired to a node that renames the chart every run, and a widget's own label
  // cannot follow that.
  const titleH = figure?.title && margin.labelled && frame.height >= 110 ? 22 : 0;
  const top = margin.top + titleH;

  const common = { frame, margin, top, min, range };
  const body = !figure ? <Empty {...common} />
    : figure.kind === 'donut' ? <Donut figure={figure} {...common} />
      : figure.kind === 'bars' ? <Bars figure={figure} {...common} />
        : <Upright figure={figure} {...common} />;

  return (
    <svg
      width={frame.width}
      height={frame.height}
      viewBox={`0 0 ${frame.width} ${frame.height}`}
      role="img"
      aria-label={figure ? `${figure.kind} chart of ${figure.points.length} points` : 'Empty chart, waiting for data'}
      style={{ background: RAISE, borderRadius: 4 }}
    >
      {titleH > 0 && (
        <text x={margin.left} y={margin.top + 8} fontSize={13} fontWeight={600} fill={TEXT}>
          {fit(figure!.title, frame.width - margin.left - margin.right)}
        </text>
      )}
      {body}
    </svg>
  );
}

interface Common {
  frame: { width: number; height: number };
  margin: ReturnType<typeof chartMargins>;
  top: number;
  min: number;
  range: number;
}

function Empty({ frame, margin, top }: Common) {
  return (
    <text
      x={frame.width / 2} y={top + (frame.height - top - margin.bottom) / 2}
      textAnchor="middle" fontSize={13} fill={DIMMER}
    >
      Waiting for data
    </text>
  );
}

/** The value axis and its gridlines, shared by everything with a baseline. */
function ValueAxis({ frame, margin, top, min, range, vertical }: Common & { vertical: boolean }) {
  const ticks = [min + range, min + range / 2, min];
  const plotW = Math.max(1, frame.width - margin.left - margin.right);
  const plotH = Math.max(1, frame.height - top - margin.bottom);
  if (!margin.labelled) return null;
  return (
    <g>
      {ticks.map((tick, i) => {
        const along = (tick - min) / range;
        const x = vertical ? margin.left : margin.left + along * plotW;
        const y = vertical ? top + plotH - along * plotH : top;
        return (
          <g key={i}>
            <line
              x1={vertical ? margin.left : x} x2={vertical ? margin.left + plotW : x}
              y1={vertical ? y : top} y2={vertical ? y : top + plotH}
              stroke={LINE} strokeWidth={1}
            />
            <text
              x={vertical ? margin.left - 5 : x} y={vertical ? y + 3 : top + plotH + 14}
              textAnchor={vertical ? 'end' : 'middle'} fontSize={11} fill={DIMMER}
            >
              {axisLabel(tick)}
            </text>
          </g>
        );
      })}
    </g>
  );
}

/** Columns and a line: categories along the bottom, values up the side. */
function Upright({ figure, ...common }: Common & { figure: Figure }) {
  const { frame, margin, top, min, range } = common;
  const plotW = Math.max(1, frame.width - margin.left - margin.right);
  const plotH = Math.max(1, frame.height - top - margin.bottom);
  const scaleY = (v: number) => top + plotH - ((v - min) / range) * plotH;
  const points = figure.points;
  const slot = plotW / points.length;
  const alongX = (i: number) => margin.left
    + (points.length === 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);

  return (
    <g>
      <ValueAxis {...common} vertical />
      <line
        x1={margin.left} x2={margin.left + plotW}
        y1={scaleY(0)} y2={scaleY(0)} stroke={DIMMER} strokeWidth={1}
      />
      {/* The category names, for whichever shape is above them: a line chart
          without them is a shape with no idea what it is a shape of. */}
      {margin.labelled && slot > 22 && points.map((p, i) => (
        <text
          key={`label-${i}`}
          x={figure.kind === 'line' ? alongX(i) : margin.left + i * slot + slot / 2}
          y={top + plotH + 26}
          textAnchor="middle" fontSize={11} fill={MUTED}
        >
          {fit(p.label, slot)}
        </text>
      ))}
      {figure.kind === 'line' ? (
        <g>
          <polyline
            fill="none" style={{ stroke: colour(0) }} strokeWidth={1.5}
            points={points.map((p, i) => `${alongX(i)},${scaleY(p.value)}`).join(' ')}
          />
          {/* A dot per reading, while they are far enough apart to be read as
              readings rather than as a texture on the line. */}
          {plotW / points.length > 14 && points.map((p, i) => (
            <circle key={i} cx={alongX(i)} cy={scaleY(p.value)} r={2.5} style={{ fill: colour(0) }}>
              <title>{`${p.label}: ${p.value}`}</title>
            </circle>
          ))}
        </g>
      ) : points.map((p, i) => {
        const x = margin.left + i * slot + slot * 0.15;
        const w = Math.max(1, slot * 0.7);
        const yZero = scaleY(0);
        const yValue = scaleY(p.value);
        return (
          <rect
            key={i}
            x={x} y={Math.min(yZero, yValue)} width={w}
            height={Math.max(1, Math.abs(yValue - yZero))}
            rx={Math.min(4, w / 3)}
            style={{ fill: colour(0) }}
          >
            <title>{`${p.label}: ${p.value}`}</title>
          </rect>
        );
      })}
    </g>
  );
}

/**
 * Horizontal bars: the shape to reach for when the categories are names.
 *
 * A name reads along the bar rather than under it, so nothing has to be turned
 * on its side or cropped to a slot, which is what columns do to "United
 * States" the moment there are more than a handful.
 */
function Bars({ figure, ...common }: Common & { figure: Figure }) {
  const { frame, margin, top } = common;
  const points = figure.points;
  const longest = Math.max(...points.map((p) => p.label.length), 1);
  const names = Math.min(Math.round(frame.width * 0.32), 8 + longest * 6.4);
  const left = margin.labelled ? Math.max(24, names) : 4;
  const right = margin.labelled ? 52 : 4;
  const plotW = Math.max(1, frame.width - left - right);
  const plotH = Math.max(1, frame.height - top - (margin.labelled ? 22 : 4));
  const max = Math.max(...points.map((p) => Math.abs(p.value)), 1);
  const slot = plotH / points.length;
  // Capped, so three rows in a tall block are bars and not three fat stripes;
  // generous enough that six rows do not read as a sparse list either.
  const bar = Math.max(2, Math.min(slot * 0.74, 40));

  return (
    <g>
      {points.map((p, i) => {
        const y = top + i * slot + (slot - bar) / 2;
        const w = Math.max(2, (Math.abs(p.value) / max) * plotW);
        return (
          <g key={i}>
            {margin.labelled && slot > 12 && (
              <text
                x={left - 8} y={y + bar / 2 + 4}
                textAnchor="end" fontSize={11} fill={MUTED}
              >
                {fit(p.label, left - 10)}
              </text>
            )}
            <rect
              x={left} y={y} width={w} height={bar}
              rx={Math.min(4, bar / 3)} style={{ fill: colour(0) }}
            >
              <title>{`${p.label}: ${p.value}`}</title>
            </rect>
            {margin.labelled && slot > 12 && (
              <text
                x={left + w + 6} y={y + bar / 2 + 4}
                fontSize={11} fill={DIM}
              >
                {axisLabel(p.value)}
              </text>
            )}
          </g>
        );
      })}
      <line
        x1={left} x2={left} y1={top} y2={top + plotH}
        stroke={DIMMER} strokeWidth={1}
      />
    </g>
  );
}

/**
 * A donut, with a legend when there is room for one.
 *
 * Shares out one whole, which is the one question bars cannot answer at a
 * glance. Below about 260px wide the legend is dropped rather than squeezed:
 * a ring with no names is still a shape, a legend in 4px type is nothing.
 */
function Donut({ figure, ...common }: Common & { figure: Figure }) {
  const { frame, margin, top } = common;
  const points = figure.points.filter((p) => p.value > 0);
  const total = points.reduce((sum, p) => sum + p.value, 0) || 1;
  const bottom = margin.labelled ? margin.bottom - 12 : 4;
  const room = Math.max(1, frame.height - top - bottom);
  const withLegend = frame.width >= 260 && margin.labelled;
  const ringBox = withLegend ? Math.min(room, frame.width * 0.45) : Math.min(room, frame.width);
  const radius = Math.max(8, ringBox / 2 - 4);
  const cx = withLegend ? 12 + radius : frame.width / 2;
  const cy = top + room / 2;
  const inner = radius * 0.58;

  let angle = -Math.PI / 2;
  const at = (r: number, a: number) => `${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`;
  const slices = points.map((p, i) => {
    const sweep = (p.value / total) * Math.PI * 2;
    const from = angle;
    const to = angle + sweep;
    angle = to;
    const large = sweep > Math.PI ? 1 : 0;
    const path = `M ${at(radius, from)} A ${radius} ${radius} 0 ${large} 1 ${at(radius, to)}`
      + ` L ${at(inner, to)} A ${inner} ${inner} 0 ${large} 0 ${at(inner, from)} Z`;
    return { path, point: p, index: i };
  });

  const legendTop = cy - Math.min(points.length, 8) * 9;
  return (
    <g>
      {slices.map(({ path, point, index }) => (
        <path key={index} d={path} style={{ fill: colour(index) }} stroke={RAISE} strokeWidth={1}>
          <title>{`${point.label}: ${point.value}`}</title>
        </path>
      ))}
      {radius > 34 && (
        <>
          <text x={cx} y={cy - 1} textAnchor="middle" fontSize={Math.min(20, radius / 2.4)} fontWeight={600} fill={TEXT}>
            {axisLabel(total)}
          </text>
          <text x={cx} y={cy + 15} textAnchor="middle" fontSize={11} fill={DIMMER}>in total</text>
        </>
      )}
      {withLegend && points.slice(0, 8).map((p, i) => {
        const y = legendTop + i * 18;
        const x = cx + radius + 20;
        return (
          <g key={i}>
            <rect x={x} y={y - 9} width={11} height={11} rx={3} style={{ fill: colour(i) }} />
            <text x={x + 18} y={y} fontSize={11} fill={MUTED}>
              {fit(p.label, frame.width - x - 90)}
            </text>
            <text x={frame.width - margin.right} y={y} textAnchor="end" fontSize={11} fill={DIM}>
              {`${axisLabel(p.value)} · ${(100 * p.value / total).toFixed(1)}%`}
            </text>
          </g>
        );
      })}
    </g>
  );
}
