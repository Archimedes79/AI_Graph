import React, { useEffect, useState } from 'react';
import type { GuiWidget } from '../types/graph';
import { GUI_WIDGET_KIND_LABELS } from '../utils/guiWidgets';
import { useGenerate } from '../elements/shared/useGenerate';
import { buildGeneration, widgetFields } from '../elements/shared/generation';
import { GUI_WIDGET_ELEMENTS } from '../elements/registry';
import AuthoredFileOption from '../elements/shared/AuthoredFileOption';
import { DIMMER, FIELD_ON_SURFACE, MUTED, WELL } from '../ui/theme';

interface GuiWidgetPropertiesProps {
  widget: GuiWidget | null;
  onChange: (patch: Partial<GuiWidget>) => void;
}

/**
 * What the widget selected on the designer canvas *is*: its name, its mode, and
 * whatever body it authors.
 *
 * This was a list editor holding every widget at once, next to a designer
 * holding the same list again -- two editable views of one thing, plus ↑↓
 * buttons whose order doubled as the layout for unplaced widgets. The canvas
 * owns arrangement now; this owns identity, and only for the one widget in
 * hand. Same shape as a node's config panel one level down, which is why it
 * draws the element's own `ConfigEditor` rather than knowing any widget kind.
 */
export default function GuiWidgetProperties({ widget, onChange }: GuiWidgetPropertiesProps) {
  // Start expanded when there is already a body: collapsed-by-default is right
  // for an empty section and wrong for a full one -- hiding code the user (or
  // the AI) has written is exactly how "where did my code go?" happens.
  const [expanded, setExpanded] = useState(false);
  const generate = useGenerate();

  useEffect(() => {
    setExpanded(!!((widget?.code ?? '').trim() || (widget?.selector_code ?? '').trim()));
  }, [widget?.id]);

  if (!widget) {
    return (
      <p className="text-xs" style={{ color: DIMMER }}>
        Select a widget on the canvas to edit it.
      </p>
    );
  }

  const element = GUI_WIDGET_ELEMENTS[widget.kind];
  const ConfigEditor = element.ConfigEditor;
  const fileSpec = element.authoredFile?.(widget);

  /**
   * The one ✨ Generate handler, for whichever widget kind asks.
   *
   * This was an `isPlot` ternary threaded through eight lines -- prompt field,
   * guard, success message, contract, both port names, target field -- which is
   * a kind-switch in a shared shell, the thing the element contract exists to
   * prevent. Each widget declares it now
   * (`GuiWidgetElementDefinition.generation`) and this component treats them
   * all alike.
   */
  const handleGenerate = () => {
    const spec = element.generation;
    if (!spec) return;
    return generate.run(buildGeneration({
      element: widget.kind,
      generation: spec,
      subject: widget,
      fields: widgetFields(widget, (patch) => {
        onChange(patch);
        // Show what was just written, rather than reporting success over a
        // section the user would have to know to open.
        setExpanded(true);
      }),
      language: widget.language || 'python',
      exampleFile: (widget.example_file ?? '').trim(),
    }), widget.id);
  };

  return (
    <div className="px-3 py-3 rounded-lg" style={WELL}>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: '#2d1b4e', color: '#c4b5fd' }}>
          {GUI_WIDGET_KIND_LABELS[widget.kind]}
        </span>
        <span className="text-xs font-mono" style={{ color: DIMMER }}>{widget.id}</span>
      </div>

      <div className="mb-2">
        <label className="block text-xs font-medium mb-1" style={{ color: MUTED }}>Name</label>
        <input
          className="w-full rounded-lg px-2 py-1.5 text-sm"
          style={FIELD_ON_SURFACE}
          value={widget.label}
          onChange={(e) => onChange({ label: e.target.value })}
          placeholder="Widget label"
        />
      </div>

      <ConfigEditor
        widget={widget}
        generation={element.generation}
        fields={widgetFields(widget, onChange)}
        onUpdate={onChange}
        expanded={expanded}
        onToggleExpand={() => setExpanded((prev) => !prev)}
        generating={generate.isGenerating(widget.id)}
        message={generate.message(widget.id)}
        onGenerate={handleGenerate}
        canGenerate={!!element.generation && (element.generation.available?.(widget) ?? true)}
      />

      {fileSpec && (
        <div className="mt-3">
          <AuthoredFileOption
            label={widget.label || widget.id}
            fileName={widget.code_file ?? ''}
            extension={fileSpec.extension}
            what={fileSpec.what}
            folderHint="<graph>.nodes/<node>/"
            onChange={(name) => onChange({ code_file: name })}
          />
        </div>
      )}
    </div>
  );
}
