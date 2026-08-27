import React from 'react';
import { ACCENT, DIM } from '../ui/theme';

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

/** Minimal, dependency-free auto-scaled SVG chart for gui-node `plot_window` widgets. */
export default function PlotWidget({ data, width = 220, height = 90 }: PlotWidgetProps) {
  const points = toPoints(data);

  if (!points) {
    // A non-chartable string is worth showing verbatim: it's either the raw
    // incoming text (so the user sees what shape actually arrived) or a
    // "⚠ transform failed" message from the backend's display transform.
    const text = typeof data === 'string' ? data.trim() : '';
    return (
      <div
        className="text-xs px-2 py-1.5 rounded whitespace-pre-wrap break-words"
        style={{ background: 'rgba(255,255,255,0.05)', color: DIM, maxHeight: 160, overflowY: 'auto' }}
      >
        {text || 'No chartable data'}
      </div>
    );
  }

  const values = points.map((p) => p.value);
  const { min, max, range } = computeAxisRange(values);

  const padding = 4;
  const plotW = width - padding * 2;
  const plotH = height - padding * 2;
  const scaleY = (v: number) => padding + plotH - ((v - min) / range) * plotH;
  const useBars = points.length <= 12;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 4 }}
    >
      <line x1={padding} x2={width - padding} y1={scaleY(0)} y2={scaleY(0)} stroke="#334155" strokeWidth={1} />
      {useBars
        ? points.map((p, i) => {
            const barWidth = plotW / points.length;
            const x = padding + i * barWidth + barWidth * 0.15;
            const w = barWidth * 0.7;
            const yZero = scaleY(0);
            const yValue = scaleY(p.value);
            const y = Math.min(yZero, yValue);
            const h = Math.max(1, Math.abs(yValue - yZero));
            return <rect key={i} x={x} y={y} width={w} height={h} fill={ACCENT} />;
          })
        : (
          <polyline
            fill="none"
            stroke={ACCENT}
            strokeWidth={1.5}
            points={points
              .map((p, i) => `${padding + (i / (points.length - 1)) * plotW},${scaleY(p.value)}`)
              .join(' ')}
          />
        )}
    </svg>
  );
}
