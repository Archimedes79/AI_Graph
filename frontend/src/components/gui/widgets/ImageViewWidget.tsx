import React from 'react';
import type { GuiWidgetRuntimeProps } from '../widgetProps';
import { DIMMER, LINE, MUTED, SUNKEN } from '../../../ui/theme';

/**
 * Runtime image_view widget: display-only.
 *
 * The backend hands this widget a `data:` URL (or a list of them) rather than a
 * path — the picture lives on the machine the graph ran on, which is not the one
 * showing this page, so it travels inline with the run's result. A value that
 * failed to load arrives as a "⚠ …" string and is shown as text.
 */
export default function ImageViewWidget({ widget, value, incoming }: GuiWidgetRuntimeProps) {
  const shown = incoming ?? value;
  const items = (Array.isArray(shown) ? shown : [shown]).filter(
    (item): item is string => typeof item === 'string' && item.length > 0,
  );

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
