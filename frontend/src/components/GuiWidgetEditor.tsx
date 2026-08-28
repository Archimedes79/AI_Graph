import React, { useState } from 'react';
import type { GuiWidget, GuiWidgetKind } from '../types/graph';
import { createGuiWidget, CREATABLE_GUI_WIDGET_KINDS, GUI_WIDGET_KIND_LABELS, sizeToGrid } from '../utils/guiWidgets';
import { useGenerate } from '../elements/shared/useGenerate';
import { buildGeneration, widgetFields } from '../elements/shared/generation';
import { GUI_WIDGET_ELEMENTS } from '../elements/registry';
import AuthoredFileOption from '../elements/shared/AuthoredFileOption';
import { DANGER, DIMMER, FIELD_ON_SURFACE, MUTED, NEUTRAL_BUTTON, PRIMARY_BUTTON, WELL } from '../ui/theme';

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
  // Widgets that already hold code start expanded. Collapsed-by-default is
  // right for an empty section and wrong for a full one: hiding code the user
  // (or the AI) has already written is exactly how "where did my code go?"
  // happens.
  const [expandedTransform, setExpandedTransform] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      widgets.filter((w) => (w.code ?? '').trim() || (w.selector_code ?? '').trim()).map((w) => [w.id, true]),
    ),
  );
  // Same generate state machine as the node editor, keyed per widget because
  // this component hosts one ✨ button per widget rather than one per editor.
  const generate = useGenerate();

  const addWidget = () => {
    const widget = createGuiWidget(newWidgetKind, newWidgetLabel.trim());
    onChange([...widgets, widget]);
    setNewWidgetLabel('');
  };

  const removeWidget = (index: number) => {
    // Removing a widget removes its ports, and saving the node then prunes
    // every edge that was attached to them -- elsewhere in the graph, out of
    // sight. Say so rather than letting wires vanish silently.
    const widget = widgets[index];
    const name = widget.label || widget.id;
    if (!window.confirm(`Remove "${name}"? Any connections to its ports will be dropped when you save this node.`)) return;
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

  /**
   * Apply a generated snippet to the widget, looked up by its stable id rather
   * than the index captured at click time -- the list may have been reordered
   * or edited while the request was in flight.
   */
  const applyToWidget = (widgetId: string, patch: Partial<GuiWidget>) => {
    const currentIndex = widgets.findIndex((w) => w.id === widgetId);
    if (currentIndex !== -1) updateWidget(currentIndex, patch);
  };

  /**
   * The one ✨ Generate handler, for whichever widget kind asks.
   *
   * This was an `isPlot` ternary threaded through eight lines -- prompt field,
   * guard, success message, contract, both port names, target field -- which is
   * a kind-switch in a shared shell, the thing the element contract exists to
   * prevent. It is also why `image_view` had a `code` field with the same
   * transform contract as plot_window and no button: nobody added the third
   * branch. Each widget declares it now (`GuiWidgetElementDefinition.generation`)
   * and this component treats them all alike.
   */
  const handleGenerate = (widget: GuiWidget) => {
    const spec = GUI_WIDGET_ELEMENTS[widget.kind].generation;
    if (!spec) return;
    return generate.run(buildGeneration({
      element: widget.kind,
      generation: spec,
      subject: widget,
      fields: widgetFields(widget, (patch) => {
        applyToWidget(widget.id, patch);
        // Show what was just written, rather than reporting success over a
        // section the user would have to know to open.
        setExpandedTransform((prev) => ({ ...prev, [widget.id]: true }));
      }),
      language: widget.language || 'python',
      exampleFile: (widget.example_file ?? '').trim(),
    }), widget.id);
  };

  return (
    <div>
      <div className="flex items-end gap-2 mb-4 px-3 py-3 rounded-lg" style={WELL}>
        <div className="flex-1">
          <label className="block text-xs font-medium mb-1" style={{ color: MUTED }}>
            Kind
          </label>
          <select
            className="w-full rounded-lg px-2 py-1.5 text-sm"
            style={FIELD_ON_SURFACE}
            value={newWidgetKind}
            onChange={(e) => setNewWidgetKind(e.target.value as GuiWidgetKind)}
          >
            {CREATABLE_GUI_WIDGET_KINDS.map((k) => (
              <option key={k} value={k}>{GUI_WIDGET_KIND_LABELS[k]}</option>
            ))}
          </select>
        </div>
        <div className="flex-1">
          <label className="block text-xs font-medium mb-1" style={{ color: MUTED }}>
            Label
          </label>
          <input
            className="w-full rounded-lg px-2 py-1.5 text-sm"
            style={FIELD_ON_SURFACE}
            value={newWidgetLabel}
            onChange={(e) => setNewWidgetLabel(e.target.value)}
            placeholder="Widget label"
          />
        </div>
        <button
          onClick={addWidget}
          className="text-xs px-3 py-1.5 rounded font-semibold"
          style={PRIMARY_BUTTON}
          aria-label="Add widget"
        >
          + Add Widget
        </button>
      </div>

      {widgets.length === 0 && (
        <p className="text-xs" style={{ color: DIMMER }}>No widgets yet — add one above.</p>
      )}

      <div className="space-y-3">
        {widgets.map((widget, index) => (
          <div key={widget.id} className="px-3 py-3 rounded-lg" style={WELL}>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: '#2d1b4e', color: '#c4b5fd' }}>
                  {GUI_WIDGET_KIND_LABELS[widget.kind]}
                </span>
                <span className="text-xs font-mono" style={{ color: DIMMER }}>{widget.id}</span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => moveWidget(index, -1)}
                  disabled={index === 0}
                  className="text-xs px-2 py-1 rounded"
                  style={{ ...NEUTRAL_BUTTON, opacity: index === 0 ? 0.4 : 1 }}
                  title="Move up"
                  aria-label={`Move ${widget.label || widget.id} up`}
                >
                  ↑
                </button>
                <button
                  onClick={() => moveWidget(index, 1)}
                  disabled={index === widgets.length - 1}
                  className="text-xs px-2 py-1 rounded"
                  style={{ ...NEUTRAL_BUTTON, opacity: index === widgets.length - 1 ? 0.4 : 1 }}
                  title="Move down"
                  aria-label={`Move ${widget.label || widget.id} down`}
                >
                  ↓
                </button>
                <button
                  onClick={() => removeWidget(index)}
                  className="text-xs px-2 py-1 rounded"
                  style={{ background: DANGER, color: 'white' }}
                  title="Remove widget"
                  aria-label={`Remove widget ${widget.label || widget.id}`}
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 mb-2">
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: MUTED }}>
                  Label
                </label>
                <input
                  className="w-full rounded-lg px-2 py-1.5 text-sm"
                  style={FIELD_ON_SURFACE}
                  value={widget.label}
                  onChange={(e) => updateWidget(index, { label: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: MUTED }}>
                  Size
                </label>
                <select
                  className="w-full rounded-lg px-2 py-1.5 text-sm"
                  style={FIELD_ON_SURFACE}
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
                  generating={generate.isGenerating(widget.id)}
                  message={generate.message(widget.id)}
                  onGenerate={() => handleGenerate(widget)}
                  canGenerate={(() => {
                    const spec = GUI_WIDGET_ELEMENTS[widget.kind].generation;
                    return !!spec && (spec.available?.(widget) ?? true);
                  })()}
                />
              );
            })()}

            {(() => {
              const fileSpec = GUI_WIDGET_ELEMENTS[widget.kind].authoredFile?.(widget);
              return fileSpec ? (
                <div className="mt-3">
                  <AuthoredFileOption
                    label={widget.label || widget.id}
                    fileName={widget.code_file ?? ''}
                    extension={fileSpec.extension}
                    what={fileSpec.what}
                    folderHint="<graph>.nodes/<node>/"
                    onChange={(name) => updateWidget(index, { code_file: name })}
                  />
                </div>
              ) : null;
            })()}
          </div>
        ))}
      </div>
    </div>
  );
}
