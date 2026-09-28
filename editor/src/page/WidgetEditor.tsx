import { Suspense } from 'react';
import type { GuiWidget } from '@/graph';
import { guiWidgetPorts, widgetFiresRun } from '@/document/guiWidgets';
import { WIDGET_BUILDERS } from '@/elements/registry';
import { GUI_GRID_COLUMNS } from '@/document/layout';
import { TONES, TONE_LABELS, type Tone } from '@/ui/tone';
import { DANGER, DIMMER, FIELD_ON_SURFACE, LINE, MUTED, WELL } from '@/ui/theme';

interface WidgetEditorProps {
  widget: GuiWidget | null;
  onChange: (patch: Partial<GuiWidget>) => void;
  /** Remove this block from the page. Dragging is what arranges it. */
  onRemove?: () => void;
}

/**
 * What the widget selected on the designer canvas *is*: its label, what using
 * it starts, its own settings drawn by its own panel, and how it looks. A block
 * has no body to write: a chart, a table or an image says in one sentence what
 * it shows, and what reshapes a value is a node.
 *
 * This was a list editor holding every widget at once, next to a designer
 * holding the same list again -- two editable views of one thing, plus ↑↓
 * buttons whose order doubled as the layout for unplaced widgets. The canvas
 * owns arrangement now; this owns identity, and only for the one widget in
 * hand. Same shape as a node's config panel one level down, which is why it
 * draws the element's own `Panel` rather than knowing any widget kind.
 */
export default function WidgetEditor({ widget, onChange, onRemove }: WidgetEditorProps) {
  if (!widget) {
    return (
      <p className="text-xs" style={{ color: DIMMER }}>
Select a block on the page — or press <kbd>/</kbd> to add one.
      </p>
    );
  }

  const element = WIDGET_BUILDERS[widget.kind];
  const Panel = element.Panel;
  // Only a block that hands something on can start the graph, or fail in a run.
  const handsOn = guiWidgetPorts(widget).outputs.length > 0;

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

      <label className="block mb-3">
        <span className="block text-xs font-medium mb-1" style={{ color: MUTED }}>Label</span>
        <input
          className="w-full rounded-lg px-2 py-1.5 text-sm"
          style={FIELD_ON_SURFACE}
          value={widget.label}
          onChange={(e) => onChange({ label: e.target.value })}
          placeholder="What it says above the block"
        />
      </label>

      {/* What starts the graph. A button or a chat always does; anything else
          with an output can be told to. */}
      {handsOn && (
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

      {/* A panel is its own chunk, loaded when a widget is first opened.
          Keyed by the block: what one block's panel holds -- a listing -- is
          not shown in the next block selected. */}
      {Panel && (
        <Suspense fallback={null}>
          <Panel key={widget.id} builder={element} widget={widget} onUpdate={onChange} />
        </Suspense>
      )}

      {/* Everything that is a preference rather than a decision: how it looks,
          its exact size, what a failure costs. Folded, because a block is
          finished without any of it -- the page used to open on these. */}
      <details className="mt-3 rounded-lg" style={{ border: `1px solid ${LINE}` }}>
        <summary className="px-3 py-2 text-xs font-medium cursor-pointer select-none" style={{ color: MUTED }}>
          {handsOn ? 'Look, size & failures' : 'Look & size'}
        </summary>
        <div className="px-3 pb-3 pt-1">
          {/* A closed set, not a colour picker: every value comes from the one
              palette, so no combination can look wrong. */}
          <label className="block mb-2">
            <span className="block text-xs font-medium mb-1" style={{ color: MUTED }}>Style</span>
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
          </label>

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

          {/* Only for a block that hands something on: a rule, a gap or a chart cannot fail. */}
          {handsOn && (
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
