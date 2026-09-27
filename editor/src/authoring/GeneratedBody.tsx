import type React from 'react';
import GenerationTranscript, { useLiveGeneration } from './GenerationTranscript';
import LiveGeneration from './LiveGeneration';
import CodeField from './CodeField';
import type { ElementGeneration, FieldAccess } from './generation';
import { ACCENT_FILL, ACCENT_TEXT, MUTED, SUCCESS } from '@/ui/theme';

interface Props {
  generation: ElementGeneration;
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
 * every authoring editor that is the same everywhere -- the button, the
 * exchange while it runs, the body in its editor, and what the last generation
 * said. What ✨ wrote is in the body at once; Undo takes it back.
 */
export default function GeneratedBody({ generation, fields, generating, message, onGenerate, title, preview, sent }: Props) {
  // From context, not a prop: the path here runs through the node's panel and
  // the four steps, which would do nothing with it but pass it on -- the same
  // reason the transcript is a context.
  const liveCalls = useLiveGeneration();

  return (
    <div>
      <div className="flex items-center justify-between mb-1 gap-3">
        <label className="text-xs font-medium" style={{ color: MUTED }}>
          {generation.bodyLabel ?? 'Result'}
        </label>
        <div className="flex items-center gap-2">
          {preview}
          <button
            onClick={() => onGenerate()}
            disabled={generating}
            className="text-xs px-2 py-1 rounded"
            style={{ background: SUCCESS, color: 'white', opacity: generating ? 0.5 : 1 }}
          >
            {generating ? '…' : '✨ Generate'}
          </button>
        </div>
      </div>
      {sent}
      {generating ? (
        <LiveGeneration calls={liveCalls} minHeight={generation.bodyHeight ?? 160} />
      ) : (
        <CodeField
          value={fields.get(generation.targetField)}
          onChange={(next) => fields.set(generation.targetField, next)}
          language={generation.language}
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
