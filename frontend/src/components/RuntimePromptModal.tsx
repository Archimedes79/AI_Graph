import React, { useState } from 'react';
import type { RuntimeRequirement } from '../types/graph';

interface RuntimePromptModalProps {
  requirements: RuntimeRequirement[];
  onSubmit: (values: Record<string, string>) => void;
  onCancel: () => void;
}

export default function RuntimePromptModal({ requirements, onSubmit, onCancel }: RuntimePromptModalProps) {
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(requirements.map((r) => [r.node_id, r.current_value || '']))
  );

  const canSubmit = requirements.every((r) => (values[r.node_id] ?? '').trim().length > 0);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.7)' }}
    >
      <div
        className="rounded-xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden flex flex-col"
        style={{ background: '#1a1d2e', border: '1px solid #2d3148', maxHeight: '90vh' }}
      >
        <div
          className="px-6 py-4"
          style={{ background: '#0f1117', borderBottom: '1px solid #2d3148' }}
        >
          <h2 className="text-lg font-bold" style={{ color: '#e2e8f0' }}>Before running…</h2>
          <p className="text-xs mt-1" style={{ color: '#94a3b8' }}>
            This graph needs a few values before it can run.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {requirements.map((req) => (
            <div key={req.node_id}>
              <label className="block text-xs font-medium mb-1" style={{ color: '#94a3b8' }}>
                {req.kind === 'text'
                  ? `Text for "${req.label}"`
                  : `${req.direction === 'input' ? 'Read' : 'Write'} ${req.kind} for "${req.label}"`}
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

        <div
          className="flex items-center justify-end gap-3 px-6 py-4"
          style={{ background: '#0f1117', borderTop: '1px solid #2d3148' }}
        >
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
  );
}
