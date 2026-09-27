import { Suspense } from 'react';
import { BLOCKS } from './blocks';
import type { GuiWidget } from '@/graph';
import { guiWidgetPorts, widgetFiresRun } from '@/document/guiWidgets';
import { useGenerate } from '@/authoring/useGenerate';
import { buildGeneration, widgetFields, type GenerationRequest } from '@/authoring/generation';
import { widgetLogic } from '@/authoring/logic';
import { WIDGET_BUILDERS } from '@/elements/registry';
import type { WidgetSteps } from '@/elements/WidgetGuiBuilder';
import { GenerationReport } from '@/authoring/GenerationTranscript';
import { useWhatSends } from '@/authoring/WhatSends';
import { useGraphStore } from '@/store/graphStore';
import { GUI_GRID_COLUMNS } from '@/document/layout';
import { schemeVars } from '@/ui/scheme';
import { blockFacts, blockFeeds, blockFromTheGraph } from '@/authoring/blockFacts';
import { tryBlock } from '@/authoring/blockStepRules';
import OpenInMyEditor from '@/authoring/OpenInMyEditor';
import { TONES, TONE_LABELS, type Tone } from '@/ui/tone';
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
 * whatever body it authors -- in the four steps, drawn by its own panel, with
 * Try it under the body rather than at the foot of the editor.
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
  const generate = useGenerate();

  /**
   * The one ✨ Generate request, for whichever widget kind asks -- the button
   * and "what ✨ sends" send the same.
   *
   * This was an `isPlot` ternary threaded through eight lines -- prompt field,
   * guard, success message, contract, both port names, target field -- which is
   * a kind-switch in a shared shell, the thing the element contract exists to
   * prevent. Each widget declares it now (`WidgetGuiBuilder.generation`), and
   * what it is told is what the graph sweep tells it too (`blockFacts`): what
   * feeds the block, the page's scheme, and step 1's example, or the last
   * run's value, with where it came from.
   */
  const request = (): GenerationRequest<GuiWidget> | undefined => {
    const spec = widget ? WIDGET_BUILDERS[widget.kind].generation : undefined;
    if (!widget || !spec) return undefined;
    const state = useGraphStore.getState();
    return {
      element: widget.kind,
      generation: spec,
      subject: widget,
      fields: widgetFields(widget, onChange),
      ...blockFacts(nodeId, widget, state.rfNodes.map((item) => item.data.graphNode), state.rfEdges, executionResult, state.metadata.gui_scheme),
    };
  };
  const sends = useWhatSends(request, widget ? `${nodeId}::${widget.id}` : '');

  if (!widget) {
    return (
      <p className="text-xs" style={{ color: DIMMER }}>
Select a block on the page — or press <kbd>/</kbd> to add one.
      </p>
    );
  }

  const element = WIDGET_BUILDERS[widget.kind];
  const Panel = element.Panel;
  const View = BLOCKS[widget.kind].View;
  const logic = widgetLogic(widget);

  const handleGenerate = () => {
    const asked = request();
    if (asked) generate.run(buildGeneration(asked), widget.id);
  };

  // In a project, a block's code is a file of its own, one folder below its
  // page's. Keyed by the block, so one block's "Opened in …" is not said of
  // the next one selected.
  const openInEditor = logic
    ? <OpenInMyEditor key={widget.id} nodeId={nodeId} widgetId={widget.id} />
    : undefined;

  // What only this shell knows, for a block that authors a body: the page it
  // sits on, and the page it is drawn in. The panel places each in its step.
  const steps: WidgetSteps | undefined = element.generation ? {
    feeds: blockFeeds(nodeId, widget, useGraphStore.getState().rfNodes.map((item) => item.data.graphNode), useGraphStore.getState().rfEdges),
    fromGraph: guiWidgetPorts(widget).inputs.length
      ? () => blockFromTheGraph(nodeId, widget, executionResult, () => useGraphStore.getState().exportGraph())
      : undefined,
    tryIt: (values) => tryBlock(widget, values),
    // What comes back is drawn by the block itself, at the block's own
    // proportions: the chart, looked at, before the graph has ever run.
    renderResult: (result) => (
      <div
        className="mt-1 rounded overflow-hidden"
        style={{ aspectRatio: `${widget.w ?? 8} / ${widget.h ?? 4}`, maxHeight: 260, border: `1px solid ${LINE}`, ...schemeVars(useGraphStore.getState().metadata.gui_scheme) }}
      >
        <View widget={widget} value={result.shown} incoming={result.shown} onChange={() => {}} />
      </div>
    ),
    preview: sends.preview,
    sent: sends.sent,
    openInEditor,
  } : undefined;

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
        {/* A panel is its own chunk, loaded when a widget is first opened.
            Keyed by the block: what one block's panel holds -- a try, a
            listing -- is not shown in the next block selected. */}
        <Suspense fallback={null}>
        <Panel
          key={widget.id}
          builder={element}
          widget={widget}
          fields={widgetFields(widget, onChange)}
          onUpdate={onChange}
          generating={generate.isGenerating(widget.id)}
          message={generate.message(widget.id)}
          onGenerate={handleGenerate}
          steps={steps}
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
    </div>
  );
}
