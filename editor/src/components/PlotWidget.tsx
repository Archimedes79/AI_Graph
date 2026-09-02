import React from 'react';
import { ACCENT, DIM, DIMMER, HOVER, MUTED, RAISE } from '../ui/theme';

interface PlotWidgetProps {
  data: unknown;
  width?: number;
  height?: number;
}

interface PlotPoint {
  label: string;
  value: number;
}

/** Coerce a `plot_window` input value into `{label, value}` points, or `null` if it can't be charted. */
function toPoints(data: unknown): PlotPoint[] | null {
  let value = data;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }

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

/** Auto-scale a set of values to an axis range that always includes 0 (so the baseline stays on-chart for all-negative or all-positive data), guarding against a zero-size range. */
export function computeAxisRange(values: number[]): { min: number; max: number; range: number } {
  const min = Math.min(0, ...values);
  const rawMax = Math.max(0, ...values);
  const max = rawMax > min ? rawMax : min + 1e-6;
  return { min, max, range: max - min };
}

/**
 * A number short enough to sit beside an axis: 1430000000 becomes 1.4G.
 *
 * An axis whose labels do not fit is an axis that hides the chart, and the
 * numbers that reach these charts are populations and byte counts as often as
 * they are percentages.
 */
export function axisLabel(value: number): string {
  const size = Math.abs(value);
  if (size >= 1e9) return `${(value / 1e9).toFixed(size >= 1e10 ? 0 : 1)}G`;
  if (size >= 1e6) return `${(value / 1e6).toFixed(size >= 1e7 ? 0 : 1)}M`;
  if (size >= 1e3) return `${(value / 1e3).toFixed(size >= 1e4 ? 0 : 1)}k`;
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(size < 1 ? 2 : 1);
}

/** Room for axes, or the bare sparkline a canvas preview has space for. */
export function chartMargins(width: number, height: number) {
  // A canvas preview is 220x90 and has no room for text: axes there would be
  // labels stacked on labels. A block on a page is taller than this.
  const labelled = width >= 200 && height >= 110;
  return labelled
    ? { left: 38, right: 8, top: 10, bottom: 22, labelled }
    : { left: 4, right: 4, top: 4, bottom: 4, labelled };
}

/** Keep a category label inside its slot rather than letting it overlap the next. */
function fit(label: string, slotWidth: number): string {
  const chars = Math.max(1, Math.floor(slotWidth / 6));
  return label.length <= chars ? label : `${label.slice(0, Math.max(1, chars - 1))}…`;
}

/**
 * Drawing the model did itself.
 *
 * A bar or line chart covers the ordinary case, and nothing beyond it: a
 * scatter, a pie, two series against each other, a legend of its own. Rather
 * than growing a chart library one option at a time, a transform may return
 * finished SVG and this draws it -- so what can be plotted is whatever the
 * model can write, not whatever was foreseen here.
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
 * A chart, dependency-free, drawn from `{label, value}` points.
 *
 * It draws its own axes: a value scale down the left and the category names
 * along the bottom. Without them the bars were a block of colour that happened
 * to have the right proportions -- correct, and unreadable, which reads to
 * whoever ran the graph as nothing having happened.
 *
 * With no data it still draws the frame and says so, rather than vanishing: an
 * empty chart is a chart that is waiting, and a blank space is a tool that
 * looks broken.
 */
export default function PlotWidget({ data, width = 220, height = 90 }: PlotWidgetProps) {
  // Finished SVG wins: the transform drew something this could not have.
  const drawing = asDrawing(data);
  if (drawing) {
    return (
      <div
        className="w-full h-full flex items-center justify-center overflow-hidden"
        style={{ background: RAISE, borderRadius: 4 }}
        // eslint-disable-next-line react/no-danger -- stripped by asDrawing above
        dangerouslySetInnerHTML={{ __html: drawing }}
      />
    );
  }

  const points = toPoints(data);
  const margin = chartMargins(width, height);
  const plotW = Math.max(1, width - margin.left - margin.right);
  const plotH = Math.max(1, height - margin.top - margin.bottom);

  // A string that is not points is worth showing verbatim: it is either the raw
  // value that arrived, or a "⚠ transform failed" message from the engine.
  const message = typeof data === 'string' ? data.trim() : '';
  if (!points && message) {
    return (
      <div
        className="text-xs px-2 py-1.5 rounded whitespace-pre-wrap break-words"
        style={{ background: HOVER, color: DIM, maxHeight: 160, overflowY: 'auto' }}
      >
        {message}
      </div>
    );
  }

  const values = points ? points.map((p) => p.value) : [0, 1];
  const { min, max, range } = computeAxisRange(values);
  const scaleY = (v: number) => margin.top + plotH - ((v - min) / range) * plotH;
  const useBars = !points || points.length <= 12;
  const ticks = [max, min + range / 2, min];

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={points ? `Chart of ${points.length} points` : 'Empty chart, waiting for data'}
      style={{ background: RAISE, borderRadius: 4 }}
    >
      {margin.labelled && (
        <g>
          {/* The value scale, and a faint line across at each step so a bar can
              be read off it rather than guessed at. */}
          {ticks.map((tick, i) => (
            <g key={i}>
              <line
                x1={margin.left} x2={width - margin.right}
                y1={scaleY(tick)} y2={scaleY(tick)}
                stroke="#1e2235" strokeWidth={1}
              />
              <text
                x={margin.left - 5} y={scaleY(tick) + 3}
                textAnchor="end" fontSize={9} fill={DIMMER}
              >
                {axisLabel(tick)}
              </text>
            </g>
          ))}
          <line
            x1={margin.left} x2={margin.left}
            y1={margin.top} y2={margin.top + plotH}
            stroke="#334155" strokeWidth={1}
          />
        </g>
      )}

      {/* The zero line, which is also the x axis whenever the data is positive. */}
      <line
        x1={margin.left} x2={width - margin.right}
        y1={scaleY(0)} y2={scaleY(0)}
        stroke="#334155" strokeWidth={1}
      />

      {points && useBars && points.map((p, i) => {
        const slot = plotW / points.length;
        const x = margin.left + i * slot + slot * 0.15;
        const w = slot * 0.7;
        const yZero = scaleY(0);
        const yValue = scaleY(p.value);
        return (
          <g key={i}>
            <rect
              x={x} y={Math.min(yZero, yValue)} width={w}
              height={Math.max(1, Math.abs(yValue - yZero))}
              style={{ fill: ACCENT }}
            >
              {/* The exact value, for the one bar being pointed at. */}
              <title>{`${p.label}: ${p.value}`}</title>
            </rect>
            {margin.labelled && (
              <text
                x={x + w / 2} y={margin.top + plotH + 13}
                textAnchor="middle" fontSize={9} fill={MUTED}
              >
                {fit(p.label, slot)}
              </text>
            )}
          </g>
        );
      })}

      {points && !useBars && (
        <polyline
          fill="none"
          style={{ stroke: ACCENT }}
          strokeWidth={1.5}
          points={points
            .map((p, i) => `${margin.left + (i / (points.length - 1)) * plotW},${scaleY(p.value)}`)
            .join(' ')}
        />
      )}

      {!points && (
        <text
          x={margin.left + plotW / 2} y={margin.top + plotH / 2}
          textAnchor="middle" fontSize={11} fill={DIMMER}
        >
          Waiting for data
        </text>
      )}
    </svg>
  );
}
