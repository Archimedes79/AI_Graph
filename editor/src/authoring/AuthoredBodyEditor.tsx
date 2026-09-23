import React from 'react';
import Step from './Step';
import ContextFileAttachment from './ContextFileAttachment';
import GenerationTranscript, { useGenerationReview, useLiveGeneration } from './GenerationTranscript';
import LiveGeneration from './LiveGeneration';
import CodeField from './CodeField';
import type { ElementGeneration, FieldAccess } from './generation';
import { ACCENT_FILL, ACCENT_TEXT, FIELD, FIELD_ON_SURFACE, MUTED, SUCCESS } from '@/ui/theme';

interface Props {
  /** How the element's body is written. Absent: the element authors nothing, and nothing is drawn. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a node's or a widget's
  generation: ElementGeneration<any> | undefined;
  /** Reading and writing the element's own fields -- see `nodeFields`/`widgetFields`. */
  fields: FieldAccess;
  exampleFile: string;
  onExampleFileChange: (path: string) => void;
  generating: boolean;
  message?: string;
  onGenerate: () => void;
  /** A widget row sits on a raised surface and uses the lighter field style. */
  onSurface?: boolean;
  /** Rendered between the 📎 attachment and the ✨ row, for whatever else the
   *  element needs to ask before generating (a format family, a checkbox). */
  children?: React.ReactNode;
  /** The snippet is not in play right now, so only the prompt half is shown. */
  bodyHidden?: boolean;
  /** What the enlarged editor is titled: the element's own name. */
  title?: string;
  /**
   * Lay the block out as the numbered steps of building a node, with the
   * shell's port lists inside them (`NodeGuiBuilder.stepped`). `inputs` goes
   * in "What comes in" beside the 📎 sample and `children`; `outputs` in
   * "What comes out"; `preview` beside ✨, for showing what it will send,
   * and `sent` under that row, where what it would send is shown.
   */
  steps?: { inputs: React.ReactNode; outputs: React.ReactNode; preview?: React.ReactNode; sent?: React.ReactNode; bodyHint?: string };
}

/**
 * The authored half of an element: what you asked for, what it is based on, and
 * what came out.
 *
 * Seven editors -- four node types and three widget kinds -- drew this same
 * sequence: a prompt box, the 📎 example attachment, an optional language
 * picker, the ✨ button and the body box, plus the result message. They had
 * already drifted: three different labels for the one attachment, a ✨ button
 * that reported into a different corner in each, and one editor (image_view)
 * that never got a button at all. The wording is declared by the element (see
 * `ElementGeneration`), so this component is the whole drawing of it.
 */
export default function AuthoredBodyEditor({
  generation, fields, exampleFile, onExampleFileChange,
  generating, message, onGenerate, onSurface, children, bodyHidden, title, steps,
}: Props) {
  // From context, not a prop: the path here runs through eight element editors
  // that would do nothing with it but pass it on -- the same reason the
  // transcript is a context.
  const liveCalls = useLiveGeneration();
  // A finished result is not written in until it is taken, so the exchange
  // that produced it stays on screen while there is something to judge.
  const review = useGenerationReview();
  const reviewing = generating || review.pending;
  const field = onSurface ? FIELD_ON_SURFACE : FIELD;
  if (!generation) return null;

  const request = (
    <textarea
      className="w-full rounded-lg px-3 py-2 text-sm resize-none"
      style={{ ...field, minHeight: 96 }}
      value={fields.get(generation.promptField)}
      onChange={(e) => fields.set(generation.promptField, e.target.value)}
      placeholder={generation.promptPlaceholder}
      aria-label={generation.promptLabel ?? 'Prompt'}
    />
  );

  const sample = (
    <ContextFileAttachment
      label={generation.exampleLabel ?? 'Example input (optional file)'}
      path={exampleFile}
      onChange={onExampleFileChange}
    />
  );

  const body = (
    <div>
      <div className="flex items-center justify-between mb-1 gap-3">
        <label className="text-xs font-medium" style={{ color: MUTED }}>
          {generation.bodyLabel ?? 'Result'}
        </label>
        <div className="flex items-center gap-2">
          {steps?.preview}
          <button
            onClick={onGenerate}
            disabled={generating}
            className="text-xs px-2 py-1 rounded"
            style={{ background: SUCCESS, color: 'white', opacity: generating ? 0.5 : 1 }}
          >
            {generating ? '…' : '✨ Generate'}
          </button>
        </div>
      </div>
      {steps?.sent}
      {reviewing ? (
        <>
          <LiveGeneration calls={liveCalls} minHeight={generation.bodyHeight ?? 160} />
          {review.pending && (
            <div className="flex items-center gap-2 mt-2">
              <button
                onClick={review.accept}
                className="text-xs px-3 py-1 rounded"
                style={{ background: SUCCESS, color: 'white' }}
              >
                Accept
              </button>
              <button
                onClick={review.discard}
                className="text-xs px-3 py-1 rounded"
                style={{ background: 'transparent', color: MUTED, border: `1px solid ${MUTED}` }}
              >
                Discard
              </button>
            </div>
          )}
        </>
      ) : (
        <CodeField
          value={fields.get(generation.targetField)}
          onChange={(next) => fields.set(generation.targetField, next)}
          language={generation.language ?? (generation.targetField.includes('prompt') ? 'markdown' : 'javascript')}
          placeholder={generation.bodyPlaceholder}
          minHeight={generation.bodyHeight ?? 160}
          title={[title, generation.bodyLabel].filter(Boolean).join(' — ')}
        />
      )}
      {message && (
        <div className="text-xs mt-2 px-2 py-1.5 rounded" style={{ background: ACCENT_FILL, color: ACCENT_TEXT }}>
          {message}
        </div>
      )}
      <GenerationTranscript />
    </div>
  );

  if (steps) {
    return (
      <>
        <Step n={1} title="What should it do?" hint="In your own words. ✨ Generate writes step 4 from this and steps 2 and 3.">
          {request}
        </Step>
        <Step n={2} title="What comes in" hint="What each input holds. Wires are drawn on the canvas, from another node's output dot to this node's input dot.">
          {steps.inputs}
          {sample}
          {children}
        </Step>
        <Step n={3} title="What comes out" hint="What each output hands on, and in what shape -- the next node is written against it.">
          {steps.outputs}
        </Step>
        {!bodyHidden && (
          <Step n={4} title="How it does it" hint={steps.bodyHint}>
            {body}
          </Step>
        )}
      </>
    );
  }

  return (
    <>
      <div>
        <label className="block text-xs font-medium mb-1" style={{ color: MUTED }}>
          {generation.promptLabel ?? 'Prompt'}
        </label>
        {request}
      </div>

      {sample}

      {children}

      {!bodyHidden && body}
    </>
  );
}
