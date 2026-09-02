import React from 'react';
import type { GuiWidget } from '@/types/graph';
import AuthoredBodyEditor from '@/elements/shared/AuthoredBodyEditor';
import type { ElementGeneration, FieldAccess } from '@/elements/shared/generation';
import { DIMMER, LINE, MUTED } from '@/ui/theme';

interface TableEditorProps {
  widget: GuiWidget;
  generation: ElementGeneration<GuiWidget>;
  fields: FieldAccess;
  onUpdate: (patch: Partial<GuiWidget>) => void;
  expanded: boolean;
  onToggleExpand: () => void;
  generating: boolean;
  message?: string;
  onGenerate: () => void;
}

export default function TableEditor({
  widget, generation, fields, onUpdate, expanded, onToggleExpand,
  generating, message, onGenerate,
}: TableEditorProps) {
  return (
    <div className="mt-3 pt-3" style={{ borderTop: `1px solid ${LINE}` }}>
      <button
        onClick={onToggleExpand}
        className="text-xs font-medium mb-1"
        style={{ color: MUTED, background: 'transparent' }}
      >
        {expanded ? '▾' : '▸'} Row transform (optional)
      </button>
      {expanded && (
        <div className="mt-2 space-y-2">
          <AuthoredBodyEditor
            generation={generation}
            fields={fields}
            exampleFile={widget.example_file ?? ''}
            onExampleFileChange={(path) => onUpdate({ example_file: path })}
            generating={generating}
            message={message}
            onGenerate={onGenerate}
            onSurface
          >
            <p className="text-xs" style={{ color: DIMMER }}>
              The code must return {`{"value": <rows>}`} — a list of objects sharing their keys
              (the keys become the columns), or a list of lists whose first row is the header.
              Leave empty to show the incoming value as-is.
            </p>
          </AuthoredBodyEditor>
        </div>
      )}
    </div>
  );
}
