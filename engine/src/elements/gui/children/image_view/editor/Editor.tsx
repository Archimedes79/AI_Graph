import React from 'react';
import type { GuiWidget } from '@/types/graph';
import AuthoredBodyEditor from '@/elements/shared/AuthoredBodyEditor';
import type { ElementGeneration, FieldAccess } from '@/elements/shared/generation';
import { MUTED } from '@/ui/theme';

interface ImageViewEditorProps {
  widget: GuiWidget;
  generation: ElementGeneration<GuiWidget>;
  fields: FieldAccess;
  onUpdate: (patch: Partial<GuiWidget>) => void;
  generating: boolean;
  message?: string;
  onGenerate: () => void;
}

/**
 * image_view has almost nothing to configure: it shows whatever file path is
 * wired into it. The optional transform is the same escape hatch plot_window
 * has, drawn by the same component -- which is how this widget finally got the
 * ✨ button it had been missing.
 */
export default function ImageViewEditor({
  widget, generation, fields, onUpdate, generating, message, onGenerate,
}: ImageViewEditorProps) {
  return (
    <div className="space-y-3">
      <p className="text-xs" style={{ color: MUTED }}>
        Wire a file path (or a list of them, from a directory picker) into this widget and it
        displays the picture. PNG, JPEG, GIF, WebP, BMP and SVG are recognised. A transform is
        only needed when the incoming value is not already a path — e.g. picking one field out
        of a record.
      </p>

      <AuthoredBodyEditor
        generation={generation}
        fields={fields}
        exampleFile={widget.example_file ?? ''}
        onExampleFileChange={(path) => onUpdate({ example_file: path })}
        generating={generating}
        message={message}
        onGenerate={onGenerate}
        onSurface
      />
    </div>
  );
}
