import React from 'react';
import type { GuiWidget } from '../../../../types/graph';

interface PlotWindowEditorProps {
  widget: GuiWidget;
  onUpdate: (patch: Partial<GuiWidget>) => void;
  expanded: boolean;
  onToggleExpand: () => void;
  generating: boolean;
  error?: string;
  onGenerate: () => void;
}

export default function PlotWindowEditor({
  widget,
  onUpdate,
  expanded,
  onToggleExpand,
  generating,
  error,
  onGenerate,
}: PlotWindowEditorProps) {
  return (
    <div className="mt-3 pt-3" style={{ borderTop: '1px solid #2d3148' }}>
      <button
        onClick={onToggleExpand}
        className="text-xs font-medium mb-1"
        style={{ color: '#94a3b8', background: 'transparent' }}
      >
        {expanded ? '▾' : '▸'} Data transform (optional)
      </button>
      {expanded && (
        <div className="mt-2">
          <p className="text-xs mb-2" style={{ color: '#475569' }}>
            Leave empty to display raw incoming data.
          </p>
          <div className="flex items-center justify-between mb-1">
            <select
              className="rounded-lg px-2 py-1 text-xs"
              style={{ background: '#1a1d2e', color: '#e2e8f0', border: '1px solid #2d3148' }}
              value={widget.language ?? 'python'}
              onChange={(e) => onUpdate({ language: e.target.value as 'python' | 'javascript' })}
            >
              <option value="python">Python</option>
              <option value="javascript">JavaScript</option>
            </select>
            <button
              onClick={onGenerate}
              disabled={generating}
              className="text-xs px-2 py-1 rounded"
              style={{ background: '#22c55e', color: 'white', opacity: generating ? 0.5 : 1 }}
            >
              {generating ? '…' : '✨ Generate'}
            </button>
          </div>
          <textarea
            className="w-full rounded-lg px-2 py-1.5 text-sm resize-none font-mono"
            style={{ background: '#1a1d2e', color: '#e2e8f0', border: '1px solid #2d3148', minHeight: 100 }}
            value={widget.code ?? ''}
            onChange={(e) => onUpdate({ code: e.target.value })}
            spellCheck={false}
          />
          {error && (
            <div className="text-xs mt-1" style={{ color: '#f87171' }}>
              ❌ {error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
