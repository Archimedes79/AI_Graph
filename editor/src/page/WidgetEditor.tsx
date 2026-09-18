import { Suspense, useEffect, useState } from 'react';
import type { GuiWidget } from '@/graph';
import { guiWidgetPorts, widgetFiresRun } from '@/elements/nodes/gui/guiWidgets';
import { useGenerate } from '@/authoring/useGenerate';
import { buildGeneration, widgetFields } from '@/authoring/generation';
import { widgetLogic } from '@/authoring/logic';
import { WIDGET_UIS } from '@/elements/registry';
import KeepInFileOption from '@/elements/fields/KeepInFileOption';
import { GenerationReport } from '@/authoring/GenerationTranscript';
import { lastRunWidgetInput } from '@/authoring/generationContext';
import { useGraphStore } from '@/store/graphStore';
import { GUI_GRID_COLUMNS } from './layout';
import { describeScheme, schemeVars } from './scheme';
import TryItPanel from '@/authoring/TryItPanel';
import { sampleFor } from '@/authoring/tryValues';
import { call } from '@/api/client';
import { TONES, TONE_LABELS, type Tone } from './tone';
import { DANGER, DIMMER, FIELD_ON_SURFACE, LINE, MUTED, WELL } from '@/ui/theme';

interface WidgetEditorProps {
  widget: GuiWidget | null;
  /** The gui node this block sits on, so its last run can be looked up. */
  nodeId: string;
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
 * draws the element's own `Panel` rather than knowing any widget kind.
 */
export default function WidgetEditor({
  widget, nodeId, onChange, onRemove,
}: WidgetEditorProps) {
  const executionResult = useGraphStore((s) => s.executionResult);
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
Select a block on the page — or press <kbd>/</kbd> to add one.
      </p>
    );
  }

  const element = WIDGET_UIS[widget.kind];
  const Panel = element.Panel;
  const subject = `${nodeId}::${widget.id}`;
  const View = element.View;
  const logic = widgetLogic(widget);

  /**
   * The one ✨ Generate handler, for whichever widget kind asks.
   *
   * This was an `isPlot` ternary threaded through eight lines -- prompt field,
   * guard, success message, contract, both port names, target field -- which is
   * a kind-switch in a shared shell, the thing the element contract exists to
   * prevent. Each widget declares it now
   * (`WidgetUi.generation`) and this component treats them
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
      // What a block draws is seen on this page, in this scheme -- and the model
      // writing it cannot see either. Said, not enforced: see `describeScheme`.
      graphContext: describeScheme(useGraphStore.getState().metadata.gui_scheme),
      // The real thing that reached this block last run. A chart transform
      // written against actual rows beats one written against a description of
      // them, and the verify pass can then run it for real.
      sampleInputs: sampleFor(subject, ['value'], lastRunWidgetInput(nodeId, widget.id, executionResult)),
    }), widget.id);
  };

  return (
    <div className="px-3 py-3 rounded-lg" style={WELL}>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: '#2d1b4e', color: '#c4b5fd' }}>
          {element.label}
        </span>
        <span className="flex-1" />
        <button
          onClick={onRemove}
          className="text-xs px-2 py-1 rounded"
          style={{ background: DANGER, color: 'white' }}
          title="Remove (Del)"
          aria-label="Remove"
        >
          ✕
        </button>
      </div>

      <div className="mb-3">
        <label className="block text-xs font-medium mb-1" style={{ color: MUTED }}>Label</label>
        <input
          className="w-full rounded-lg px-2 py-1.5 text-sm"
          style={FIELD_ON_SURFACE}
          value={widget.label}
          onChange={(e) => onChange({ label: e.target.value })}
          placeholder="What it says above the block"
        />
      </div>

      {/* What starts the graph. A button or a chat always does; anything else
          with an output can be told to. */}
      {guiWidgetPorts(widget).outputs.length > 0 && (
        <div className="mb-3">
          {widgetFiresRun({ ...widget, run_on_change: false }) ? (
            <p className="text-xs" style={{ color: MUTED }}>
              ⚡ Using this starts the graph — at the nodes it is wired to, or all of it when it is
              wired to nothing. Wire it to a node's <span style={{ color: '#f59e0b' }}>◆</span> to say
              “start here” without sending a value.
            </p>
          ) : (
            <>
              <label className="flex items-center gap-2 text-xs" style={{ color: MUTED }}>
                <input
                  type="checkbox"
                  checked={widget.run_on_change === true}
                  onChange={(e) => onChange({ run_on_change: e.target.checked })}
                />
                ⚡ Using this starts the graph
              </label>
              <p className="text-xs mt-1" style={{ color: DIMMER }}>
                {element.runOnChangeHint}
              </p>
            </>
          )}
        </div>
      )}

      {Panel && (
        <GenerationReport
          calls={generate.transcript(widget.id)}
          live={generate.liveTranscript(widget.id)}
          review={{
            pending: generate.isPending(widget.id),
            accept: () => generate.accept(widget.id),
            discard: () => generate.discard(widget.id),
          }}
        >
        {/* A panel is its own chunk, loaded when a widget is first opened. */}
        <Suspense fallback={null}>
        <Panel
          ui={element}
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
        </Suspense>
        </GenerationReport>
      )}

      {/* Everything that is a preference rather than a decision: how it looks,
          its exact size, what a failure costs. Folded, because a block is
          finished without any of it -- the page used to open on these. */}
      <details className="mt-3 rounded-lg" style={{ border: `1px solid ${LINE}` }}>
        <summary className="px-3 py-2 text-xs font-medium cursor-pointer select-none" style={{ color: MUTED }}>
          Look, size & failures
        </summary>
        <div className="px-3 pb-3 pt-1">
          {/* A closed set, not a colour picker: every value comes from the one
              palette, so no combination can look wrong. */}
          <label className="block text-xs font-medium mb-1" style={{ color: MUTED }}>Style</label>
          <select
            className="w-full rounded-lg px-2 py-1.5 text-sm mb-2"
            style={FIELD_ON_SURFACE}
            value={(widget.tone as Tone) ?? 'raised'}
            onChange={(e) => onChange({ tone: e.target.value as Tone })}
          >
            {TONES.map((tone) => (
              <option key={tone} value={tone}>{TONE_LABELS[tone]}</option>
            ))}
          </select>

          {/* On top of the style: a frame or not, and a colour of your own. Unset
              means the style decides, which is what "Default" puts back. */}
          <div className="flex items-center gap-4 mb-3 text-xs" style={{ color: MUTED }}>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={widget.border ?? widget.tone !== 'plain'}
                onChange={(e) => onChange({ border: e.target.checked })}
              />
              Frame
            </label>
            <label className="flex items-center gap-2">
              Background
              <input
                type="color"
                value={widget.background || '#000000'}
                onChange={(e) => onChange({ background: e.target.value })}
                title={widget.background || 'Decided by the style'}
              />
            </label>
            {(widget.border !== undefined || widget.background) && (
              <button type="button" className="text-xs underline" onClick={() => onChange({ border: undefined, background: '' })}>
                Default
              </button>
            )}
          </div>

          {/* Exact cells, for when ¼ ½ ¾ on the block is not the size wanted. */}
          <div className="flex items-center gap-3 mb-3">
            {([['w', 'Width', GUI_GRID_COLUMNS], ['h', 'Height', 99]] as const).map(([field, label, max]) => (
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
            <span className="text-xs" style={{ color: DIMMER }}>cells of {GUI_GRID_COLUMNS}</span>
          </div>

          {/* Only for a block that does something: a rule or a gap cannot fail. */}
          {guiWidgetPorts(widget).outputs.length > 0 && (
            <div>
              <label className="flex items-center gap-2 text-xs" style={{ color: MUTED }}>
                <input
                  type="checkbox"
                  checked={widget.catch_errors === true}
                  onChange={(e) => onChange({ catch_errors: e.target.checked })}
                />
                Catch a failure instead of ending the run
              </label>
              <p className="text-xs mt-1" style={{ color: DIMMER }}>
                Off, a failure in this block ends the whole run, and every other block's output with
                it. On, the block grows an <strong style={{ color: '#a78bfa' }}>error</strong> output
                saying why, its other outputs stay empty, and the page carries on. Wiring that
                output is optional.
              </p>
            </div>
          )}
        </div>
      </details>

      {/* A block that reshapes what it is shown is tried like any other element
          -- and what comes back is drawn by the block itself, at the block's own
          proportions: the chart, looked at, before the graph has ever run. */}
      {element.generation && logic?.kind === 'code' && guiWidgetPorts(widget).inputs.length > 0 && (
        <div className="mt-3">
          <TryItPanel
            subject={subject}
            title="Try it: what arrives, and what this block shows"
            ports={[{ id: 'value', name: 'what arrives' }]}
            observed={lastRunWidgetInput(nodeId, widget.id, executionResult) ?? {}}
            context={describeScheme(useGraphStore.getState().metadata.gui_scheme)}
            onFetch={async () => {
              const got = await call('nodeInputs', { ...useGraphStore.getState().exportGraph(), node_id: nodeId });
              const arrived = got.inputs[`${widget.id}_in`];
              return { inputs: arrived === undefined ? {} : { value: arrived }, error: got.error };
            }}
            onTest={async (values) => call('runBlock', { widget, value: values.value })}
            renderResult={(result) => (
              <div
                className="mt-1 rounded overflow-hidden"
                style={{ aspectRatio: `${widget.w ?? 8} / ${widget.h ?? 4}`, maxHeight: 260, border: `1px solid ${LINE}`, ...schemeVars(useGraphStore.getState().metadata.gui_scheme) }}
              >
                <View widget={widget} value={result.shown} incoming={result.shown} onChange={() => {}} />
              </div>
            )}
          />
        </div>
      )}

      {logic && (
        <div className="mt-3">
          <KeepInFileOption
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
