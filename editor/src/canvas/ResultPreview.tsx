import type { ExecutionStatus } from '@/graph';
import type { Preview } from '@/elements/resultPreview';
import { computeAxisRange } from '@/elements/widgets/plot_window/PlotChart';
import { statusTone } from '@/store/executionStatus';

/**
 * One value a node made, under the port it stands at: a line, a count and its
 * first row, a sketch, or a thumbnail -- never more than a small picture high,
 * so a run does not push the graph apart. What the value *is* was decided
 * before this (`elements/resultPreview.ts`, and the element that reads it);
 * this only draws it, in the colours of the run that made it (`statusTone`):
 * green, or amber where it lost items. Faded when the node stood still this
 * round, and what stands is what it made before.
 */
export default function ResultPreview({ preview, status = 'success', held }: {
  preview: Preview;
  /** How the run that made it went: delivered, or delivered with items lost (`partial`). */
  status?: ExecutionStatus;
  held?: boolean;
}) {
  const box = 'text-xs px-1 py-0.5 rounded min-w-0 w-full';
  const tone = statusTone(held ? 'success' : status);
  const style = { background: tone.bg, color: tone.fg, opacity: held ? 0.6 : 1 };
  switch (preview.kind) {
    case 'line':
      return <div className={`${box} truncate`} style={style} title={preview.text}>{preview.text}</div>;
    case 'rows':
      return (
        <div className={box} style={style} title={preview.first}>
          <div className="font-semibold">
            {preview.count === 0 ? 'empty list' : `${preview.count} ${preview.count === 1 ? preview.noun.slice(0, -1) : preview.noun}`}
          </div>
          {preview.first && <div className="truncate font-mono">{preview.first}</div>}
        </div>
      );
    case 'sketch':
      return <div className={box} style={style}><Sketch values={preview.values} line={preview.line} /></div>;
    case 'image':
      return (
        <div className={`${box} flex items-center gap-1`} style={style}>
          <img src={preview.src} alt="" style={{ maxHeight: 48, maxWidth: '100%', objectFit: 'contain', borderRadius: 2 }} />
          {preview.count > 1 && <span>+{preview.count - 1}</span>}
        </div>
      );
  }
}

/** A failed node's reason, on one line; the whole of it on hover. */
export function ErrorPreview({ line, error }: { line: string; error: string }) {
  const tone = statusTone('error');
  return (
    <div className="text-xs px-1 py-0.5 rounded truncate min-w-0 w-full" style={{ background: tone.bg, color: tone.fg }} title={error}>
      {line}
    </div>
  );
}

/** Numbers as a line or bars, 24 pixels high, as wide as the node: the shape, not the figures. */
function Sketch({ values, line }: { values: number[]; line: boolean }) {
  const { min, range } = computeAxisRange(values);
  const y = (value: number) => 22 - ((value - min) / range) * 20;
  const step = 100 / Math.max(values.length, 1);
  return (
    <svg viewBox="0 0 100 24" preserveAspectRatio="none" width="100%" height={24} role="img"
      aria-label={`${line ? 'line' : 'bars'} of ${values.length} values`}>
      {line ? (
        <polyline
          fill="none" stroke="currentColor" strokeWidth={1.5} vectorEffect="non-scaling-stroke"
          points={values.map((value, i) => `${values.length === 1 ? 50 : (i / (values.length - 1)) * 100},${y(value)}`).join(' ')}
        />
      ) : values.map((value, i) => (
        <rect key={i} x={i * step + step * 0.15} width={step * 0.7}
          y={Math.min(y(0), y(value))} height={Math.max(0.5, Math.abs(y(value) - y(0)))} fill="currentColor" />
      ))}
    </svg>
  );
}
