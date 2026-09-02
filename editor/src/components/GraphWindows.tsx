import React, { useEffect, useState } from 'react';
import { useGraphStore } from '../store/graphStore';
import type { RuntimeRequirement } from '../types/graph';
import Modal from './Modal';
import FileBrowserDialog from './FileBrowserDialog';
import { DIMMER, FIELD, LINE, MUTED, NEUTRAL_BUTTON, PRIMARY_BUTTON, SUNKEN, SURFACE, TEXT } from '../ui/theme';

interface GraphWindowsProps {
  requirements: RuntimeRequirement[] | null;
  onSubmit: (values: Record<string, string>) => void;
  onCancel: () => void;
}

const KIND_ICON: Record<string, string> = { text: '📝', file: '📄', directory: '📁' };

const windowChrome = {
  background: SURFACE,
  border: `1px solid ${LINE}`,
} as const;
const headerChrome = { background: SUNKEN, borderBottom: `1px solid ${LINE}` } as const;

/**
 * Renders the "before running" input-requirement window and the post-run
 * text-output windows together, sharing the same floating-window chrome.
 */
export default function GraphWindows({ requirements, onSubmit, onCancel }: GraphWindowsProps) {
  const outputWindows = useGraphStore((s) => s.textOutputWindows);
  const closeOutputWindow = useGraphStore((s) => s.closeTextOutputWindow);

  const [values, setValues] = useState<Record<string, string>>({});
  /** Key of the requirement whose picker is open, or '' for none. */
  const [browsing, setBrowsing] = useState('');

  // Widget-scoped requirements are keyed "{node_id}::{widget_id}", matching
  // the backend's apply_runtime_values convention; plain node requirements
  // use node_id alone.
  const keyFor = (req: RuntimeRequirement) => (req.widget_id ? `${req.node_id}::${req.widget_id}` : req.node_id);

  useEffect(() => {
    if (requirements) {
      setValues(Object.fromEntries(requirements.map((r) => [keyFor(r), r.current_value || ''])));
    }
  }, [requirements]);

  if (!requirements && outputWindows.length === 0) return null;

  // Only input-direction requirements are mandatory; output paths are optional.
  const missing = (requirements ?? [])
    .filter((r) => r.direction === 'input' && (values[keyFor(r)] ?? '').trim().length === 0)
    .map((r) => r.label);
  const canSubmit = !!requirements && missing.length === 0;

  // Which picker the open Browse… belongs to: a directory requirement picks a
  // folder, a file requirement picks a file.
  const browsingKind = (requirements ?? []).find((r) => keyFor(r) === browsing)?.kind ?? 'file';

  return (
    <>
      {requirements && (
        <Modal
          title="📥 Before running…"
          onClose={onCancel}
          scrollBody
          // Typed paths; a backdrop click must not discard them. Escape is the
          // deliberate way out and matches Cancel.
          dismissOnBackdrop={false}
          footer={
            <>
              {/* A greyed-out Run button with no explanation just looks broken. */}
              {missing.length > 0 && (
                <span className="text-xs mr-auto" style={{ color: MUTED }}>
                  Still needed: {missing.join(', ')}
                </span>
              )}
              <button
                onClick={onCancel}
                className="px-4 py-2 text-sm rounded-lg"
                style={NEUTRAL_BUTTON}
              >
                Cancel
              </button>
              <button
                onClick={() => onSubmit(values)}
                disabled={!canSubmit}
                className="px-4 py-2 text-sm rounded-lg font-semibold"
                style={{ ...PRIMARY_BUTTON, opacity: canSubmit ? 1 : 0.5 }}
              >
                ▶ Run Graph
              </button>
            </>
          }
        >
          <div className="px-6 pt-4 pb-1">
            <p className="text-xs" style={{ color: MUTED }}>
              This graph needs a few values before it can run.
            </p>
          </div>

          <div
            className="px-6 py-5 space-y-4"
            // Enter in any field runs, as in every other one-purpose dialog.
            onKeyDown={(e) => {
              if (e.key === 'Enter' && canSubmit) onSubmit(values);
            }}
          >
            {requirements.map((req, index) => (
              <div key={keyFor(req)}>
                <label className="block text-xs font-medium mb-1" style={{ color: MUTED }}>
                  {KIND_ICON[req.kind] ?? '📄'}{' '}
                  {req.kind === 'text'
                    ? `Text for "${req.label}"`
                    : `${req.direction === 'input' ? 'Read' : 'Write'} ${req.kind} for "${req.label}"`}
                  {req.direction === 'output' && (
                    <span className="ml-1 text-xs" style={{ color: DIMMER }}>(optional)</span>
                  )}
                </label>
                <div className="flex items-center gap-2">
                  <input
                    className={`flex-1 min-w-0 rounded-lg px-3 py-2 text-sm ${req.kind === 'text' ? '' : 'font-mono'}`}
                    style={FIELD}
                    value={values[keyFor(req)] ?? ''}
                    onChange={(e) => setValues((prev) => ({ ...prev, [keyFor(req)]: e.target.value }))}
                    placeholder={
                      req.kind === 'text' ? 'Enter text…' : req.kind === 'directory' ? '/path/to/directory' : '/path/to/file'
                    }
                    autoFocus={index === 0}
                  />
                  {/* Typing an absolute path from memory was the only way to
                      answer this dialog; a path field should offer a picker. */}
                  {req.kind !== 'text' && (
                    <button
                      type="button"
                      className="text-xs px-3 py-2 rounded-lg flex-shrink-0"
                      style={NEUTRAL_BUTTON}
                      onClick={() => setBrowsing(keyFor(req))}
                    >
                      Browse…
                    </button>
                  )}
                </div>
              </div>
            ))}
            {browsing && (
              <FileBrowserDialog
                mode={browsingKind === 'directory' ? 'directory' : 'file'}
                initialPath={values[browsing] ?? ''}
                onPick={(picked) => {
                  setValues((prev) => ({ ...prev, [browsing]: picked }));
                  setBrowsing('');
                }}
                onClose={() => setBrowsing('')}
              />
            )}
          </div>
        </Modal>
      )}

      {outputWindows.length > 0 && (
        <div className="fixed z-40 flex flex-col-reverse gap-3" style={{ bottom: 16, right: 352 }}>
          {outputWindows.map((win, i) => (
            <div
              key={win.nodeId}
              className="rounded-xl shadow-2xl flex flex-col"
              style={{
                ...windowChrome,
                width: 480,
                maxWidth: '90vw',
                height: 320,
                maxHeight: '60vh',
                resize: 'both',
                overflow: 'hidden',
                marginRight: i * 12,
              }}
            >
              <div className="flex items-center justify-between px-4 py-2 flex-shrink-0" style={headerChrome}>
                <span className="text-sm font-semibold flex items-center gap-2" style={{ color: TEXT }}>
                  🪟 {win.label}
                </span>
                <button
                  onClick={() => closeOutputWindow(win.nodeId)}
                  style={{ color: MUTED }}
                  className="hover:text-white text-sm"
                  aria-label={`Close output window ${win.label}`}
                >
                  ✕
                </button>
              </div>
              <pre className="flex-1 overflow-auto px-4 py-3 text-sm whitespace-pre-wrap" style={{ color: TEXT }}>
                {win.content}
              </pre>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
