import React, { useState } from 'react';
import type { AIProvider, GuiWidget, GuiWidgetKind } from '../types/graph';
import { createGuiWidget, CREATABLE_GUI_WIDGET_KINDS, GUI_WIDGET_KIND_LABELS, sizeToGrid } from '../utils/guiWidgets';
import { generateCode } from '../utils/api';
import InputPickerEditor from './widgets/editors/InputPickerEditor';
import TextIoEditor from './widgets/editors/TextIoEditor';
import PlotWindowEditor from './widgets/editors/PlotWindowEditor';

interface GuiWidgetEditorProps {
  widgets: GuiWidget[];
  onChange: (widgets: GuiWidget[]) => void;
  aiModel: string;
  aiProvider: AIProvider;
}

export default function GuiWidgetEditor({ widgets, onChange, aiModel, aiProvider }: GuiWidgetEditorProps) {
  const [newWidgetKind, setNewWidgetKind] = useState<GuiWidgetKind>('text_io');
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
            {CREATABLE_GUI_WIDGET_KINDS.map((k) => (
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
                  onChange={(e) => {
                    const s = e.target.value as typeof widget.size;
                    updateWidget(index, { size: s, ...sizeToGrid(s) });
                  }}
                >
                  <option value="small">Small</option>
                  <option value="medium">Medium</option>
                  <option value="large">Large</option>
                </select>
              </div>
            </div>

            {(widget.kind === 'file_open' || widget.kind === 'directory_open' || widget.kind === 'input_picker') && (
              <InputPickerEditor widget={widget} onUpdate={(patch) => updateWidget(index, patch)} />
            )}

            {(widget.kind === 'text_window' || widget.kind === 'chat_window' || widget.kind === 'text_io') && (
              <TextIoEditor widget={widget} onUpdate={(patch) => updateWidget(index, patch)} />
            )}

            {widget.kind === 'plot_window' && (
              <PlotWindowEditor
                widget={widget}
                onUpdate={(patch) => updateWidget(index, patch)}
                expanded={!!expandedTransform[widget.id]}
                onToggleExpand={() => toggleTransform(widget.id)}
                generating={generatingId === widget.id}
                error={transformErrors[widget.id]}
                onGenerate={() => handleGenerateTransform(widget)}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
