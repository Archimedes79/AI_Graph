import type React from 'react';
import GenerationTranscript, { useGenerationReview, useLiveGeneration } from './GenerationTranscript';
import LiveGeneration from './LiveGeneration';
import CodeField from './CodeField';
import type { ElementGeneration, FieldAccess } from './generation';
import { ACCENT_FILL, ACCENT_TEXT, MUTED, SUCCESS } from '@/ui/theme';

interface Props {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a node's or a widget's
  generation: ElementGeneration<any>;
  fields: FieldAccess;
  generating: boolean;
  message?: string;
  onGenerate: () => void;
  /** What the enlarged editor is titled: the element's own name. */
  title?: string;
  /** Beside ✨: showing what it would send. */
  preview?: React.ReactNode;
  /** Under the ✨ row: what it would send, when asked. */
  sent?: React.ReactNode;
}

/**
 * The body an element authors, and the ✨ button that writes it: the part of
 * every authoring editor that is the same everywhere -- the button, a result
 * waiting to be accepted or discarded while the exchange that produced it
 * stays on screen, the body in its editor, and what the last generation said.
 */
export default function GeneratedBody({ generation, fields, generating, message, onGenerate, title, preview, sent }: Props) {
  // From context, not a prop: the path here runs through eight element editors
  // that would do nothing with it but pass it on -- the same reason the
  // transcript is a context.
  const liveCalls = useLiveGeneration();
  // A finished result is not written in until it is taken, so the exchange
  // that produced it stays on screen while there is something to judge.
  const review = useGenerationReview();
  const reviewing = generating || review.pending;

  return (
    <div>
      <div className="flex items-center justify-between mb-1 gap-3">
        <label className="text-xs font-medium" style={{ color: MUTED }}>
          {generation.bodyLabel ?? 'Result'}
        </label>
        <div className="flex items-center gap-2">
          {preview}
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
      {sent}
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
}
