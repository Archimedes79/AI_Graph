import AuthoredBodyEditor from '@/authoring/AuthoredBodyEditor';
import { DIMMER, LINE, MUTED } from '@/ui/theme';
import type { WidgetPanelProps } from '../WidgetGuiBuilder';
import { TransformingDisplayGuiBuilder } from './TransformingDisplayGuiBuilder';

/**
 * The settings of a chart, a table or an image: its optional transform.
 *
 * Three panels drew this with only a title and one sentence between them; the
 * words now come from the widget's own builder (`transformTitle`, `transformHelp`,
 * `intro`), and this is the drawing of all three.
 */
export default function TransformingDisplayPanel({
  builder, widget, generation, fields, onUpdate, expanded, onToggleExpand, generating, message, onGenerate,
}: WidgetPanelProps) {
  if (!(builder instanceof TransformingDisplayGuiBuilder)) return null;
  return (
    <div className="space-y-3">
      {builder.intro && <p className="text-xs" style={{ color: MUTED }}>{builder.intro}</p>}
      <div className="pt-3" style={{ borderTop: `1px solid ${LINE}` }}>
        <button
          onClick={onToggleExpand}
          className="text-xs font-medium mb-1"
          style={{ color: MUTED, background: 'transparent' }}
        >
          {expanded ? '▾' : '▸'} {builder.transformTitle}
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
              <p className="text-xs" style={{ color: DIMMER }}>{builder.transformHelp}</p>
            </AuthoredBodyEditor>
          </div>
        )}
      </div>
    </div>
  );
}
