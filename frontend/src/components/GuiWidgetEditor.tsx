import React, { useEffect, useState } from 'react';
import type { GuiWidget } from '../types/graph';
import { GUI_WIDGET_KIND_LABELS } from '../utils/guiWidgets';
import { useGenerate } from '../elements/shared/useGenerate';
import { buildGeneration, widgetFields } from '../elements/shared/generation';
import { widgetLogic } from '../elements/shared/logic';
import { GUI_WIDGET_ELEMENTS } from '../elements/registry';
import AuthoredFileOption from '../elements/shared/AuthoredFileOption';
import { GenerationReport } from '../elements/shared/GenerationTranscript';
import { GUI_GRID_COLUMNS } from './gui/layout';
import { TONES, TONE_LABELS, type Tone } from './gui/tone';
import { DANGER, DIMMER, FIELD_ON_SURFACE, MUTED, NEUTRAL_BUTTON, WELL } from '../ui/theme';

interface GuiWidgetPropertiesProps {
  widget: GuiWidget | null;
  onChange: (patch: Partial<GuiWidget>) => void;
  /** Remove this block from the page. Dragging is what arranges it. */
  onRemove?: () => void;
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
export default function GuiWidgetProperties({
  widget, onChange, onRemove,
}: GuiWidgetPropertiesProps) {
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
Wähle einen Block auf der Seite aus.
      </p>
    );
  }

  const element = GUI_WIDGET_ELEMENTS[widget.kind];
  const ConfigEditor = element.ConfigEditor;
  const logic = widgetLogic(widget);

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
      exampleFile: (widget.example_file ?? '').trim(),
    }), widget.id);
  };

  return (
    <div className="px-3 py-3 rounded-lg" style={WELL}>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: '#2d1b4e', color: '#c4b5fd' }}>
          {GUI_WIDGET_KIND_LABELS[widget.kind]}
        </span>
        <span className="flex-1" />
        <button
          onClick={onRemove}
          className="text-xs px-2 py-1 rounded"
          style={{ background: DANGER, color: 'white' }}
          title="Entfernen (Entf)"
          aria-label="Entfernen"
        >
          ✕
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 mb-2">
        <div>
          <label className="block text-xs font-medium mb-1" style={{ color: MUTED }}>Name</label>
          <input
            className="w-full rounded-lg px-2 py-1.5 text-sm"
            style={FIELD_ON_SURFACE}
            value={widget.label}
            onChange={(e) => onChange({ label: e.target.value })}
            placeholder="Beschriftung"
          />
        </div>
        <div>
          {/* A closed set, not a colour picker: every value comes from the one
              palette, so no combination can look wrong. */}
          <label className="block text-xs font-medium mb-1" style={{ color: MUTED }}>Darstellung</label>
          <select
            className="w-full rounded-lg px-2 py-1.5 text-sm"
            style={FIELD_ON_SURFACE}
            value={(widget.tone as Tone) ?? 'raised'}
            onChange={(e) => onChange({ tone: e.target.value as Tone })}
          >
            {TONES.map((tone) => (
              <option key={tone} value={tone}>{TONE_LABELS[tone]}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Exact cells, for when dragging the corner is fiddlier than typing. */}
      <div className="flex items-center gap-3 mb-3">
        {([['w', 'Breite', GUI_GRID_COLUMNS], ['h', 'Höhe', 99]] as const).map(([field, label, max]) => (
          <label key={field} className="flex items-center gap-1 text-xs" style={{ color: DIMMER }}>
            {label}
            <input
              type="number"
              min={1}
              max={max}
              className="w-14 rounded px-1 py-0.5 text-xs"
              style={FIELD_ON_SURFACE}
              value={(widget[field] as number) ?? 1}
              onChange={(e) => onChange({ [field]: Math.max(1, Math.min(max, Number(e.target.value) || 1)) })}
            />
          </label>
        ))}
        <span className="text-xs" style={{ color: DIMMER }}>Zellen von {GUI_GRID_COLUMNS}</span>
      </div>

      {ConfigEditor && (
        <GenerationReport calls={generate.transcript(widget.id)}>
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
        </GenerationReport>
      )}

      {logic && (
        <div className="mt-3">
          <AuthoredFileOption
            label={widget.label || widget.id}
            fileName={widget.code_file ?? ''}
            extension={logic.extension}
            what={logic.what}
            folderHint="<graph>.nodes/<node>/"
            onChange={(name) => onChange({ code_file: name })}
          />
        </div>
      )}
    </div>
  );
}
