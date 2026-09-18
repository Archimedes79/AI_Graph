import React, { Suspense, useEffect, useState } from 'react';
import { FIELD, LINE, MUTED, NEUTRAL_BUTTON, SUNKEN, PRIMARY_BUTTON, SCRIM, SURFACE, TEXT } from '../../ui/theme';

export type CodeLanguage = 'javascript' | 'markdown';

// Loaded when a body is first drawn, never before: see CodeSurface.
const Surface = React.lazy(() => import('./CodeSurface'));

interface CodeFieldProps {
  value: string;
  onChange: (value: string) => void;
  language: CodeLanguage;
  placeholder?: string;
  minHeight?: number;
  /** What the enlarged editor is called: "Draw chart — code". */
  title?: string;
  /** Extra buttons for the enlarged editor's header, e.g. "Open in VS Code". */
  actions?: React.ReactNode;
}

/**
 * Where a body is written: a real editor in place of a textarea.
 *
 * The boxes that hold a node's code and its prompts were `<textarea>`s --
 * no highlighting, no bracket matching, Tab jumped to the next field, and a
 * sixty-line function was read through a slot six lines high. This is
 * CodeMirror: syntax colours, line numbers, bracket matching, search
 * (Ctrl+F), multiple cursors, undo that belongs to the box rather than to the
 * browser -- and ⤢ opens the same document across the whole window, because
 * the honest fix for a small window is a big one.
 *
 * For anything longer-lived there is still the other way out: keep the body
 * in a file beside the graph and open that file in your own editor. The two
 * compose -- this is for the edit you make here, that is for the afternoon
 * you spend in VS Code.
 */
export default function CodeField({
  value, onChange, language, placeholder, minHeight = 160, title, actions,
}: CodeFieldProps) {
  const [large, setLarge] = useState(false);

  // What is there for the moment the editor takes to arrive: the same text in
  // a plain box, editable, so nothing about the dialog waits on a download.
  const plain = (
    <textarea
      className="w-full rounded-lg px-3 py-2 text-sm font-mono resize-none"
      style={{ ...FIELD, minHeight }}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      spellCheck={false}
    />
  );

  useEffect(() => {
    if (!large) return undefined;
    // Escape closes the large editor and nothing else: left to bubble, it
    // would reach the node dialog underneath and ask to discard the node.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setLarge(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [large]);

  return (
    <div className="relative">
      <Suspense fallback={plain}>
        <Surface
          value={value} onChange={onChange} language={language} placeholder={placeholder}
          height={{ min: minHeight, max: '46vh' }}
        />
      </Suspense>
      <button
        type="button"
        onClick={() => setLarge(true)}
        className="absolute text-xs px-1.5 py-0.5 rounded"
        style={{ top: 6, right: 8, ...NEUTRAL_BUTTON, opacity: 0.85 }}
        title="Edit in a large window (Esc to come back)"
        aria-label="Edit in a large window"
      >
        ⤢
      </button>

      {large && (
        <div
          className="fixed inset-0 flex flex-col"
          style={{ zIndex: 200, background: SCRIM, padding: '3vh 3vw' }}
          role="dialog"
          aria-label={title ?? 'Editor'}
        >
          <div
            className="flex items-center gap-3 px-4 py-2 rounded-t-lg"
            style={{ background: SURFACE, borderBottom: `1px solid ${LINE}` }}
          >
            <span className="text-sm font-semibold" style={{ color: TEXT }}>{title ?? 'Editor'}</span>
            <span className="text-xs" style={{ color: MUTED }}>
              Ctrl+F search · Ctrl+D next match · Alt+↑↓ move line · Esc done
            </span>
            <span className="flex-1" />
            {actions}
            <button type="button" className="text-xs px-3 py-1 rounded" style={PRIMARY_BUTTON} onClick={() => setLarge(false)}>
              Done
            </button>
          </div>
          <div className="flex-1 min-h-0 rounded-b-lg overflow-hidden" style={{ background: SUNKEN }}>
            <Suspense fallback={plain}>
              <Surface
                value={value} onChange={onChange} language={language} placeholder={placeholder}
                height={{ min: 200, fill: true }} autoFocus
              />
            </Suspense>
          </div>
        </div>
      )}
    </div>
  );
}
