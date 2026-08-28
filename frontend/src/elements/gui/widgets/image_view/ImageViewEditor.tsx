import React from 'react';
import type { GuiWidget } from '../../../../types/graph';
import { DIMMER, FIELD, MUTED } from '../../../../ui/theme';

interface ImageViewEditorProps {
  widget: GuiWidget;
  onChange: (patch: Partial<GuiWidget>) => void;
}

/**
 * image_view has almost nothing to configure: it shows whatever file path is
 * wired into it. The optional transform is the same escape hatch plot_window
 * has, for the case where the incoming value needs reshaping into a path first.
 */
export default function ImageViewEditor({ widget, onChange }: ImageViewEditorProps) {
  return (
    <div className="space-y-3">
      <p className="text-xs" style={{ color: MUTED }}>
        Wire a file path (or a list of them, from a directory picker) into this widget and it
        displays the picture. PNG, JPEG, GIF, WebP, BMP and SVG are recognised.
      </p>

      <div>
        <label className="block text-xs font-medium mb-1" style={{ color: MUTED }}>
          Optional transform — <code>run(inputs)</code> receives {'{'}"value"{'}'} and returns {'{'}"value"{'}'}
        </label>
        <textarea
          className="w-full rounded-lg px-3 py-2 text-sm resize-none font-mono"
          style={{ ...FIELD, minHeight: 90 }}
          value={widget.code ?? ''}
          onChange={(e) => onChange({ code: e.target.value })}
          placeholder="Leave empty to display the incoming path as-is."
          spellCheck={false}
        />
        <p className="text-xs mt-1" style={{ color: DIMMER }}>
          Only needed when the incoming value is not already a path — e.g. picking one field out of
          a record.
        </p>
      </div>
    </div>
  );
}
