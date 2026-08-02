import React, { useState } from 'react';
import type { AIProvider, GuiWidget, GuiWidgetKind } from '../types/graph';
import { createGuiWidget, GUI_WIDGET_KIND_LABELS } from '../utils/guiWidgets';
import { generateCode } from '../utils/api';

interface GuiWidgetEditorProps {
  widgets: GuiWidget[];
  onChange: (widgets: GuiWidget[]) => void;
  aiModel: string;
  aiProvider: AIProvider;
}

export default function GuiWidgetEditor({ widgets, onChange, aiModel, aiProvider }: GuiWidgetEditorProps) {
  const [newWidgetKind, setNewWidgetKind] = useState<GuiWidgetKind>('text_window');
  const [newWidgetLabel, setNewWidgetLabel] = useState('');
  const [expandedTransform, setExpandedTransform] = useState<Record<string, boolean>>({});
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [transformErrors, setTransformErrors] = useState<Record<string, string>>({});

  const addWidget = () => {
    const widget = createGuiWidget(newWidgetKind, newWidgetLabel.trim());
    onChange([...widgets, widget]);
    setNewWidgetLabel('');
  };

  const removeWidget = (index: number) => {
    onChange(widgets.filter((_, i) => i !== index));
  };

  const moveWidget = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= widgets.length) return;
    const next = [...widgets];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  const updateWidget = (index: number, patch: Partial<GuiWidget>) => {
    const next = widgets.map((w, i) => (i === index ? { ...w, ...patch } : w));
    onChange(next);
  };

  const toggleTransform = (id: string) => {
    setExpandedTransform((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleGenerateTransform = async (widget: GuiWidget) => {
    setGeneratingId(widget.id);
    setTransformErrors((prev) => ({ ...prev, [widget.id]: '' }));
    try {
      const language = widget.language ?? 'python';
      const result = await generateCode({
        description:
          'Transform the incoming data into a plottable array: either a list of numbers, or a list of {x, y} objects, or a list of {label, value} objects, suitable for a simple chart',
        language,
        context:
          'Must expose run(inputs: dict) -> dict, receiving {"value": <raw incoming data>} and returning {"value": <plot-ready data>}.',
        ai_model: aiModel,
        ai_provider: aiProvider,
      });
      // Look up the widget's current position by stable id, not the index
      // captured at click time -- the list may have been reordered/edited
      // while this request was in flight.
      const currentIndex = widgets.findIndex((w) => w.id === widget.id);
      if (currentIndex === -1) return;
      updateWidget(currentIndex, { code: result.code });
    } catch (e: any) {
      setTransformErrors((prev) => ({
        ...prev,
        [widget.id]: e?.response?.data?.detail ?? e?.message ?? 'Error generating code',
      }));
    } finally {
      setGeneratingId(null);
    }
  };

  return (
    <div>
      <div className="flex items-end gap-2 mb-4 px-3 py-3 rounded-lg" style={{ background: '#0f1117', border: '1px solid #2d3148' }}>
        <div className="flex-1">
          <label className="block text-xs font-medium mb-1" style={{ color: '#94a3b8' }}>
            Kind
          </label>
          <select
            className="w-full rounded-lg px-2 py-1.5 text-sm"
            style={{ background: '#1a1d2e', color: '#e2e8f0', border: '1px solid #2d3148' }}
            value={newWidgetKind}
            onChange={(e) => setNewWidgetKind(e.target.value as GuiWidgetKind)}
          >
            {(Object.keys(GUI_WIDGET_KIND_LABELS) as GuiWidgetKind[]).map((k) => (
              <option key={k} value={k}>{GUI_WIDGET_KIND_LABELS[k]}</option>
            ))}
          </select>
        </div>
        <div className="flex-1">
          <label className="block text-xs font-medium mb-1" style={{ color: '#94a3b8' }}>
            Label
          </label>
          <input
            className="w-full rounded-lg px-2 py-1.5 text-sm"
            style={{ background: '#1a1d2e', color: '#e2e8f0', border: '1px solid #2d3148' }}
            value={newWidgetLabel}
            onChange={(e) => setNewWidgetLabel(e.target.value)}
            placeholder="Widget label"
          />
        </div>
        <button
          onClick={addWidget}
          className="text-xs px-3 py-1.5 rounded font-semibold"
          style={{ background: '#6366f1', color: 'white' }}
        >
          + Add Widget
        </button>
      </div>

      {widgets.length === 0 && (
        <p className="text-xs" style={{ color: '#475569' }}>No widgets yet — add one above.</p>
      )}

      <div className="space-y-3">
        {widgets.map((widget, index) => (
          <div key={widget.id} className="px-3 py-3 rounded-lg" style={{ background: '#0f1117', border: '1px solid #2d3148' }}>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: '#2d1b4e', color: '#c4b5fd' }}>
                  {GUI_WIDGET_KIND_LABELS[widget.kind]}
                </span>
                <span className="text-xs font-mono" style={{ color: '#475569' }}>{widget.id}</span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => moveWidget(index, -1)}
                  disabled={index === 0}
                  className="text-xs px-2 py-1 rounded"
                  style={{ background: '#2d3148', color: '#e2e8f0', opacity: index === 0 ? 0.4 : 1 }}
                  title="Move up"
                >
                  ↑
                </button>
                <button
                  onClick={() => moveWidget(index, 1)}
                  disabled={index === widgets.length - 1}
                  className="text-xs px-2 py-1 rounded"
                  style={{ background: '#2d3148', color: '#e2e8f0', opacity: index === widgets.length - 1 ? 0.4 : 1 }}
                  title="Move down"
                >
                  ↓
                </button>
                <button
                  onClick={() => removeWidget(index)}
                  className="text-xs px-2 py-1 rounded"
                  style={{ background: '#ef4444', color: 'white' }}
                  title="Remove widget"
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 mb-2">
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: '#94a3b8' }}>
                  Label
                </label>
                <input
                  className="w-full rounded-lg px-2 py-1.5 text-sm"
                  style={{ background: '#1a1d2e', color: '#e2e8f0', border: '1px solid #2d3148' }}
                  value={widget.label}
                  onChange={(e) => updateWidget(index, { label: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: '#94a3b8' }}>
                  Size
                </label>
                <select
                  className="w-full rounded-lg px-2 py-1.5 text-sm"
                  style={{ background: '#1a1d2e', color: '#e2e8f0', border: '1px solid #2d3148' }}
                  value={widget.size}
                  onChange={(e) => updateWidget(index, { size: e.target.value as typeof widget.size })}
                >
                  <option value="small">Small</option>
                  <option value="medium">Medium</option>
                  <option value="large">Large</option>
                </select>
              </div>
            </div>

            {(widget.kind === 'file_open' || widget.kind === 'directory_open') && (
              <div className="mb-2">
                <label className="block text-xs font-medium mb-1" style={{ color: '#94a3b8' }}>
                  Default path
                </label>
                <input
                  className="w-full rounded-lg px-2 py-1.5 text-sm"
                  style={{ background: '#1a1d2e', color: '#e2e8f0', border: '1px solid #2d3148' }}
                  value={widget.value ?? ''}
                  onChange={(e) => updateWidget(index, { value: e.target.value })}
                  placeholder={widget.kind === 'file_open' ? '/path/to/file' : '/path/to/directory'}
                />
              </div>
            )}

            {widget.kind === 'directory_open' && (
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: '#94a3b8' }}>
                  Extensions filter (comma-separated, e.g. .md, .txt)
                </label>
                <input
                  className="w-full rounded-lg px-2 py-1.5 text-sm font-mono"
                  style={{ background: '#1a1d2e', color: '#e2e8f0', border: '1px solid #2d3148' }}
                  value={widget.extensions}
                  onChange={(e) => updateWidget(index, { extensions: e.target.value })}
                  placeholder="Leave empty for all file types"
                />
              </div>
            )}

            {(widget.kind === 'text_window' || widget.kind === 'chat_window') && (
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: '#94a3b8' }}>
                  {widget.kind === 'text_window' ? 'Default text' : 'Simulated message (for preview)'}
                </label>
                <textarea
                  className="w-full rounded-lg px-2 py-1.5 text-sm resize-none"
                  style={{ background: '#1a1d2e', color: '#e2e8f0', border: '1px solid #2d3148', minHeight: 60 }}
                  value={widget.value ?? ''}
                  onChange={(e) => updateWidget(index, { value: e.target.value })}
                />
              </div>
            )}

            {widget.kind === 'plot_window' && (
              <div className="mt-3 pt-3" style={{ borderTop: '1px solid #2d3148' }}>
                <button
                  onClick={() => toggleTransform(widget.id)}
                  className="text-xs font-medium mb-1"
                  style={{ color: '#94a3b8', background: 'transparent' }}
                >
                  {expandedTransform[widget.id] ? '▾' : '▸'} Data transform (optional)
                </button>
                {expandedTransform[widget.id] && (
                  <div className="mt-2">
                    <p className="text-xs mb-2" style={{ color: '#475569' }}>
                      Leave empty to display raw incoming data.
                    </p>
                    <div className="flex items-center justify-between mb-1">
                      <select
                        className="rounded-lg px-2 py-1 text-xs"
                        style={{ background: '#1a1d2e', color: '#e2e8f0', border: '1px solid #2d3148' }}
                        value={widget.language ?? 'python'}
                        onChange={(e) => updateWidget(index, { language: e.target.value as 'python' | 'javascript' })}
                      >
                        <option value="python">Python</option>
                        <option value="javascript">JavaScript</option>
                      </select>
                      <button
                        onClick={() => handleGenerateTransform(widget)}
                        disabled={generatingId === widget.id}
                        className="text-xs px-2 py-1 rounded"
                        style={{ background: '#22c55e', color: 'white', opacity: generatingId === widget.id ? 0.5 : 1 }}
                      >
                        {generatingId === widget.id ? '…' : '✨ Generate'}
                      </button>
                    </div>
                    <textarea
                      className="w-full rounded-lg px-2 py-1.5 text-sm resize-none font-mono"
                      style={{ background: '#1a1d2e', color: '#e2e8f0', border: '1px solid #2d3148', minHeight: 100 }}
                      value={widget.code ?? ''}
                      onChange={(e) => updateWidget(index, { code: e.target.value })}
                      spellCheck={false}
                    />
                    {transformErrors[widget.id] && (
                      <div className="text-xs mt-1" style={{ color: '#f87171' }}>
                        ❌ {transformErrors[widget.id]}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
