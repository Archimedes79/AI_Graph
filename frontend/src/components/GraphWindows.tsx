import React, { useEffect, useState } from 'react';
import { useGraphStore } from '../store/graphStore';
import type { RuntimeRequirement } from '../types/graph';

interface GraphWindowsProps {
  requirements: RuntimeRequirement[] | null;
  onSubmit: (values: Record<string, string>) => void;
  onCancel: () => void;
}

const KIND_ICON: Record<string, string> = { text: '📝', file: '📄', directory: '📁' };

const windowChrome = {
  background: '#1a1d2e',
  border: '1px solid #2d3148',
} as const;
const headerChrome = { background: '#0f1117', borderBottom: '1px solid #2d3148' } as const;

/**
 * Renders the "before running" input-requirement window and the post-run
 * text-output windows together, sharing the same floating-window chrome.
 */
export default function GraphWindows({ requirements, onSubmit, onCancel }: GraphWindowsProps) {
  const outputWindows = useGraphStore((s) => s.textOutputWindows);
  const closeOutputWindow = useGraphStore((s) => s.closeTextOutputWindow);

  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    if (requirements) {
      setValues(Object.fromEntries(requirements.map((r) => [r.node_id, r.current_value || ''])));
    }
  }, [requirements]);

  if (!requirements && outputWindows.length === 0) return null;

// Only input-direction requirements are mandatory; output paths are optional.
    const canSubmit = !!requirements && requirements.filter((r) => r.direction === 'input').every((r) => (values[r.node_id] ?? '').trim().length > 0);

  return (
    <>
      {requirements && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.6)' }}
        >
          <div
            className="rounded-xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden flex flex-col"
            style={{ ...windowChrome, maxHeight: '90vh' }}
          >
            <div className="px-6 py-4" style={headerChrome}>
              <h2 className="text-sm font-semibold flex items-center gap-2" style={{ color: '#e2e8f0' }}>
                📥 Before running…
              </h2>
              <p className="text-xs mt-1" style={{ color: '#94a3b8' }}>
                This graph needs a few values before it can run.
              </p>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
              {requirements.map((req) => (
                <div key={req.node_id}>
                  <label className="block text-xs font-medium mb-1" style={{ color: '#94a3b8' }}>
                    {KIND_ICON[req.kind] ?? '📄'}{' '}
                    {req.kind === 'text'
                      ? `Text for "${req.label}"`
                      : `${req.direction === 'input' ? 'Read' : 'Write'} ${req.kind} for "${req.label}"`}
                    {req.direction === 'output' && (
                      <span className="ml-1 text-xs" style={{ color: '#475569' }}>(optional)</span>
                    )}
                  </label>
                  <input
                    className={`w-full rounded-lg px-3 py-2 text-sm ${req.kind === 'text' ? '' : 'font-mono'}`}
                    style={{ background: '#0f1117', color: '#e2e8f0', border: '1px solid #2d3148' }}
                    value={values[req.node_id] ?? ''}
                    onChange={(e) => setValues((prev) => ({ ...prev, [req.node_id]: e.target.value }))}
                    placeholder={
                      req.kind === 'text' ? 'Enter text…' : req.kind === 'directory' ? '/path/to/directory' : '/path/to/file'
                    }
                    autoFocus
                  />
                </div>
              ))}
            </div>

            <div className="flex items-center justify-end gap-3 px-6 py-4" style={headerChrome}>
              <button
                onClick={onCancel}
                className="px-4 py-2 text-sm rounded-lg"
                style={{ background: '#2d3148', color: '#e2e8f0' }}
              >
                Cancel
              </button>
              <button
                onClick={() => onSubmit(values)}
                disabled={!canSubmit}
                className="px-4 py-2 text-sm rounded-lg font-semibold"
                style={{ background: '#6366f1', color: 'white', opacity: canSubmit ? 1 : 0.5 }}
              >
                ▶ Run Graph
              </button>
            </div>
          </div>
        </div>
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
                <span className="text-sm font-semibold flex items-center gap-2" style={{ color: '#e2e8f0' }}>
                  🪟 {win.label}
                </span>
                <button
                  onClick={() => closeOutputWindow(win.nodeId)}
                  style={{ color: '#94a3b8' }}
                  className="hover:text-white text-sm"
                >
                  ✕
                </button>
              </div>
              <pre className="flex-1 overflow-auto px-4 py-3 text-sm whitespace-pre-wrap" style={{ color: '#e2e8f0' }}>
                {win.content}
              </pre>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
