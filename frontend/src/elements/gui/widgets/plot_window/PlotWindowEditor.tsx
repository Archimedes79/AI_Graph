import React from 'react';
import type { GuiWidget } from '../../../../types/graph';
import ContextFileAttachment from '../../../shared/ContextFileAttachment';
import { ACCENT_TEXT, DIMMER, FIELD_ON_SURFACE, LINE, MUTED, SUCCESS } from '../../../../ui/theme';

interface PlotWindowEditorProps {
  widget: GuiWidget;
  onUpdate: (patch: Partial<GuiWidget>) => void;
  expanded: boolean;
  onToggleExpand: () => void;
  generating: boolean;
  message?: string;
  onGenerate: () => void;
}

export default function PlotWindowEditor({
  widget,
  onUpdate,
  expanded,
  onToggleExpand,
  generating,
  message,
  onGenerate,
}: PlotWindowEditorProps) {
  return (
    <div className="mt-3 pt-3" style={{ borderTop: `1px solid ${LINE}` }}>
      <button
        onClick={onToggleExpand}
        className="text-xs font-medium mb-1"
        style={{ color: MUTED, background: 'transparent' }}
      >
        {expanded ? '▾' : '▸'} Plotting code (optional)
      </button>
      {expanded && (
        <div className="mt-2">
          <label className="block text-xs font-medium mb-1" style={{ color: MUTED }}>
            Prompt
          </label>
          <textarea
            className="w-full rounded-lg px-2 py-1.5 text-sm resize-none"
            style={{ ...FIELD_ON_SURFACE, minHeight: 72 }}
            value={widget.plot_prompt ?? ''}
            onChange={(e) => onUpdate({ plot_prompt: e.target.value })}
            placeholder="Describe the chart transform you need (axes, grouping, aggregation, filters, etc.)"
            spellCheck={false}
          />
          <div className="mt-2">
            <ContextFileAttachment
              label="Additional data (optional context file)"
              path={widget.example_input_path ?? ''}
              onChange={(path) => onUpdate({ example_input_path: path })}
            />
          </div>
          <p className="text-xs mb-2" style={{ color: DIMMER }}>
            The code must return {`{"value": <plot-ready data>}`} — a list of numbers or of{' '}
            {`{"label", "value"}`} objects; the chart itself is drawn by the app (standard library
            only, no matplotlib). Leave empty to chart the incoming value as-is.
          </p>
          <div className="flex items-center justify-between mb-1">
            <select
              className="rounded-lg px-2 py-1 text-xs"
              style={FIELD_ON_SURFACE}
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
              style={{ background: SUCCESS, color: 'white', opacity: generating ? 0.5 : 1 }}
            >
              {generating ? '…' : '✨ Generate'}
            </button>
          </div>
          <label className="block text-xs font-medium mb-1" style={{ color: MUTED }}>
            Plotting code (optional)
          </label>
          <textarea
            className="w-full rounded-lg px-2 py-1.5 text-sm resize-none font-mono"
            style={{ ...FIELD_ON_SURFACE, minHeight: 100 }}
            value={widget.code ?? ''}
            onChange={(e) => onUpdate({ code: e.target.value })}
            spellCheck={false}
          />
          {message && (
            <div className="text-xs mt-2 px-2 py-1.5 rounded" style={{ background: 'rgba(99,102,241,0.1)', color: ACCENT_TEXT }}>
              {message}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
