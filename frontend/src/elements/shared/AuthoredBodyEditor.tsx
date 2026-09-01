import React from 'react';
import ContextFileAttachment from './ContextFileAttachment';
import type { ElementGeneration, FieldAccess } from './generation';
import { ACCENT_FILL, ACCENT_TEXT, FIELD, FIELD_ON_SURFACE, MUTED, SUCCESS } from '../../ui/theme';

interface Props {
  generation: ElementGeneration<any>;
  /** Reading and writing the element's own fields -- see `nodeFields`/`widgetFields`. */
  fields: FieldAccess;
  exampleFile: string;
  onExampleFileChange: (path: string) => void;
  generating: boolean;
  message?: string;
  onGenerate: () => void;
  /** A widget row sits on a raised surface and uses the lighter field style. */
  onSurface?: boolean;
  /** Rendered between the 📎 attachment and the ✨ row, for whatever else the
   *  element needs to ask before generating (a format family, a checkbox). */
  children?: React.ReactNode;
  /** The snippet is not in play right now, so only the prompt half is shown. */
  bodyHidden?: boolean;
}

/**
 * The authored half of an element: what you asked for, what it is based on, and
 * what came out.
 *
 * Seven editors -- four node types and three widget kinds -- drew this same
 * sequence: a prompt box, the 📎 example attachment, an optional language
 * picker, the ✨ button and the body box, plus the result message. They had
 * already drifted: three different labels for the one attachment, a ✨ button
 * that reported into a different corner in each, and one editor (image_view)
 * that never got a button at all. The wording is declared by the element (see
 * `ElementGeneration`), so this component is the whole drawing of it.
 */
export default function AuthoredBodyEditor({
  generation, fields, exampleFile, onExampleFileChange,
  generating, message, onGenerate, onSurface, children, bodyHidden,
}: Props) {
  const field = onSurface ? FIELD_ON_SURFACE : FIELD;
  const mono = generation.mono ?? generation.language;

  return (
    <>
      <div>
        <label className="block text-xs font-medium mb-1" style={{ color: MUTED }}>
          {generation.promptLabel ?? 'Prompt'}
        </label>
        <textarea
          className="w-full rounded-lg px-3 py-2 text-sm resize-none"
          style={{ ...field, minHeight: 96 }}
          value={fields.get(generation.promptField)}
          onChange={(e) => fields.set(generation.promptField, e.target.value)}
          placeholder={generation.promptPlaceholder}
        />
      </div>

      <ContextFileAttachment
        label={generation.exampleLabel ?? 'Example input (optional file)'}
        path={exampleFile}
        onChange={onExampleFileChange}
      />

      {children}

      {!bodyHidden && (
        <div>
          <div className="flex items-center justify-between mb-1 gap-3">
            <label className="text-xs font-medium" style={{ color: MUTED }}>
              {generation.bodyLabel ?? 'Result'}
            </label>
            <div className="flex items-center gap-2">
              {generation.language && (
                <select
                  className="rounded px-2 py-1 text-xs"
                  style={field}
                  aria-label="Language"
                  value={fields.get('language') || 'javascript'}
                  onChange={(e) => fields.set('language', e.target.value)}
                >
                  <option value="python">Python</option>
                  <option value="javascript">JavaScript</option>
                </select>
              )}
              <button
                onClick={onGenerate}
                disabled={generating}
                className="text-xs px-2 py-1 rounded"
                style={{ background: SUCCESS, color: 'white', opacity: generating ? 0.5 : 1 }}
              >
                {generating ? '…' : '✨ Generate'}
              </button>
            </div>
          </div>
          <textarea
            className={`w-full rounded-lg px-3 py-2 text-sm resize-none${mono ? ' font-mono' : ''}`}
            style={{ ...field, minHeight: generation.bodyHeight ?? 160 }}
            value={fields.get(generation.targetField)}
            onChange={(e) => fields.set(generation.targetField, e.target.value)}
            placeholder={generation.bodyPlaceholder}
            spellCheck={!mono}
          />
          {message && (
            <div className="text-xs mt-2 px-2 py-1.5 rounded" style={{ background: ACCENT_FILL, color: ACCENT_TEXT }}>
              {message}
            </div>
          )}
        </div>
      )}
    </>
  );
}
