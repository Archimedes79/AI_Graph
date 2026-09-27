import type { WidgetViewProps } from '../WidgetView';
import { DIMMER, LINE, MUTED, SUNKEN } from '@/ui/theme';

/**
 * What to say about a value that arrived and is not a path: a record with the
 * path somewhere inside it, most often. It used to be dropped, and the block
 * said nothing had arrived -- "wire a file path into it" -- when one had been
 * wired, and a value had come.
 */
function notAPath(block: string, value: unknown): string {
  const seen = JSON.stringify(value) ?? String(value);
  return `⚠ ${block} shows an image file path or URL, and what arrived is ${seen.length > 120 ? `${seen.slice(0, 120)}…` : seen}. `
    + 'A code node wired in before it can pick the path out of it.';
}

/**
 * Runtime image_view widget: display-only.
 *
 * The backend hands this widget a `data:` URL (or a list of them) rather than a
 * path — the picture lives on the machine the graph ran on, which is not the one
 * showing this page, so it travels inline with the run's result. A value that
 * failed to load arrives as a "⚠ …" string and is shown as text.
 */
export default function ImageViewWidgetView({ widget, value, incoming }: WidgetViewProps) {
  const shown = incoming ?? value;
  // Nothing arrived: nothing, or an empty path. Anything else did arrive, and
  // is either something to draw or something to say.
  const arrived = (Array.isArray(shown) ? shown : [shown]).filter(
    (item) => item !== null && item !== undefined && item !== '',
  );
  const items = arrived.map((item) => (typeof item === 'string' ? item : notAPath(widget.label || widget.id, item)));

  const images = items.filter((item) => item.startsWith('data:') || item.startsWith('http'));
  const problems = items.filter((item) => !item.startsWith('data:') && !item.startsWith('http'));

  return (
    <div className="h-full overflow-auto rounded-lg p-2" style={{ background: SUNKEN, border: `1px solid ${LINE}` }}>
      {images.length === 0 && problems.length === 0 && (
        <p className="text-xs p-2" style={{ color: DIMMER }}>
          Nothing to show yet — wire a file path into {widget.label || widget.id} and run the graph.
        </p>
      )}

      {problems.map((problem, index) => (
        <p key={`problem-${index}`} className="text-xs p-2" style={{ color: '#fcd34d' }}>{problem}</p>
      ))}

      <div className={images.length > 1 ? 'grid gap-2' : ''}
           style={images.length > 1 ? { gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))' } : undefined}>
        {images.map((src, index) => (
          <img
            key={`${src.slice(0, 32)}-${index}`}
            src={src}
            alt={images.length > 1 ? `${widget.label || widget.id} ${index + 1}` : widget.label || widget.id}
            className="rounded"
            style={{ width: '100%', height: 'auto', objectFit: 'contain', maxHeight: images.length > 1 ? 120 : '100%' }}
          />
        ))}
      </div>

      {images.length > 1 && (
        <p className="text-xs mt-2 px-1" style={{ color: MUTED }}>{images.length} images</p>
      )}
    </div>
  );
}
