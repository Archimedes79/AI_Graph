import React, { useState } from 'react';
import type { GuiWidget, GuiWidgetKind } from '../types/graph';
import { createGuiWidget, CREATABLE_GUI_WIDGET_KINDS, GUI_WIDGET_KIND_LABELS, sizeToGrid } from '../utils/guiWidgets';
import { generateCode } from '../utils/api';
import { genAI } from '../store/settingsStore';
import { GUI_WIDGET_ELEMENTS } from '../elements/registry';

interface GuiWidgetEditorProps {
  widgets: GuiWidget[];
  onChange: (widgets: GuiWidget[]) => void;
}

// Widgets no longer carry a generation provider/model of their own, and this
// component no longer takes one from its node: every ✨ Generate action in the
// editor uses the single code-generation AI from the settings store.
export default function GuiWidgetEditor({ widgets, onChange }: GuiWidgetEditorProps) {
  const [newWidgetKind, setNewWidgetKind] = useState<GuiWidgetKind>('text_io');
  const [newWidgetLabel, setNewWidgetLabel] = useState('');
  const [expandedTransform, setExpandedTransform] = useState<Record<string, boolean>>({});
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  // Shared success/error feedback for any widget's "✨ Generate" action, keyed
  // by widget id -- mirrors NodeEditor.tsx's single genMessage banner so code
  // generation gives the same feedback everywhere it's used.
  const [genMessages, setGenMessages] = useState<Record<string, string>>({});

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
    const prompt = (widget.plot_prompt ?? '').trim();
    if (!prompt) {
      setGenMessages((prev) => ({
        ...prev,
        [widget.id]: '❌ Plot prompt is required before generating transform code.',
      }));
      return;
    }
    setGeneratingId(widget.id);
    setGenMessages((prev) => ({ ...prev, [widget.id]: '' }));
    try {
      const language = widget.language ?? 'python';
      const result = await generateCode({
        description: prompt,
        language,
        context:
          'Must expose run(inputs: dict) -> dict, receiving {"value": <raw incoming data>} and returning {"value": <plot-ready data>}.',
        context_file: (widget.example_input_path ?? '').trim() || undefined,
        inputs: ['value'],
        outputs: ['value'],
        ...genAI(),
      });
      // Look up the widget's current position by stable id, not the index
      // captured at click time -- the list may have been reordered/edited
      // while this request was in flight.
      const currentIndex = widgets.findIndex((w) => w.id === widget.id);
      if (currentIndex === -1) return;
      updateWidget(currentIndex, { code: result.code });
      setGenMessages((prev) => ({ ...prev, [widget.id]: '✅ Transform generated!' }));
    } catch (e: any) {
      setGenMessages((prev) => ({
        ...prev,
        [widget.id]: `❌ ${e?.response?.data?.detail ?? e?.message ?? 'Error generating code'}`,
      }));
    } finally {
      setGeneratingId(null);
    }
  };

  const handleGenerateSelector = async (widget: GuiWidget) => {
    const prompt = (widget.selector_prompt ?? '').trim();
    if (!prompt) {
      setGenMessages((prev) => ({
        ...prev,
        [widget.id]: '❌ Please describe which files to select first.',
      }));
      return;
    }
    setGeneratingId(widget.id);
    setGenMessages((prev) => ({ ...prev, [widget.id]: '' }));
    try {
      const language = widget.language || 'python';
      const result = await generateCode({
        description: prompt,
        language,
        context:
          '`inputs["files"]` is the full list of rooted file paths found in the directory. Return only the selected paths as {"files": [...]}.',
        context_file: (widget.example_input_path ?? '').trim() || undefined,
        inputs: ['files'],
        outputs: ['files'],
        ...genAI(),
      });
      const currentIndex = widgets.findIndex((w) => w.id === widget.id);
      if (currentIndex === -1) return;
      updateWidget(currentIndex, { selector_code: result.code });
      setGenMessages((prev) => ({ ...prev, [widget.id]: '✅ Selector generated!' }));
    } catch (e: any) {
      setGenMessages((prev) => ({
        ...prev,
        [widget.id]: `❌ ${e?.response?.data?.detail ?? e?.message ?? 'Error generating code'}`,
      }));
    } finally {
      setGeneratingId(null);
    }
  };

  const handleGenerate = (widget: GuiWidget) =>
    widget.kind === 'plot_window' ? handleGenerateTransform(widget) : handleGenerateSelector(widget);

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

            {(() => {
              const ConfigEditor = GUI_WIDGET_ELEMENTS[widget.kind].ConfigEditor;
              return (
                <ConfigEditor
                  widget={widget}
                  onUpdate={(patch: Partial<GuiWidget>) => updateWidget(index, patch)}
                  expanded={!!expandedTransform[widget.id]}
                  onToggleExpand={() => toggleTransform(widget.id)}
                  generating={generatingId === widget.id}
                  message={genMessages[widget.id]}
                  onGenerate={() => handleGenerate(widget)}
                />
              );
            })()}
          </div>
        ))}
      </div>
    </div>
  );
}
