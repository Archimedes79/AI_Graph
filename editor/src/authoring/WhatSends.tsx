import { useEffect, useState, type ReactNode } from 'react';
import type { AICall } from '@/api/client';
import { errorText } from '@/api/errorText';
import { SentPart } from './GenerationTranscript';
import { previewGeneration, type GenerationRequest } from './generation';
import { MUTED, NEUTRAL_BUTTON } from '@/ui/theme';

/**
 * "What ✨ sends": the request ✨ Generate would send, built by the server and
 * stopped before the model -- everything the model is told, shown before the
 * button is pressed. A generation that goes wrong is usually one that was told
 * the wrong thing. *request* is the one the button sends (`buildGeneration`),
 * so the two cannot describe different requests.
 *
 * `preview` is the button, for beside ✨; `sent` is the request, for under it.
 * *about* names what it is shown for: another element in the same editor
 * folds away what was shown for the last one.
 */
export function useWhatSends<S>(request: () => GenerationRequest<S> | undefined, about?: string): { preview: ReactNode; sent: ReactNode } {
  const [sends, setSends] = useState<AICall[] | null>(null);
  const [note, setNote] = useState('');
  useEffect(() => { setSends(null); setNote(''); }, [about]);

  const toggle = async () => {
    if (sends) { setSends(null); return; }
    const asked = request();
    if (!asked) return;
    setNote('Building the request…');
    try {
      setSends(await previewGeneration(asked));
      setNote('');
    } catch (error) {
      setNote(errorText(error, 'Could not build the request.'));
    }
  };

  return {
    preview: (
      <button onClick={toggle} className="text-xs px-2 py-1 rounded" style={NEUTRAL_BUTTON}
        title="Show the request ✨ Generate would send -- everything the model is told -- without sending it">
        {sends ? 'Hide what ✨ sends' : 'What ✨ sends'}
      </button>
    ),
    sent: (sends || note) ? (
      <div className="mb-2 space-y-2 text-xs" aria-label="What Generate sends">
        {note && <p style={{ color: MUTED }}>{note}</p>}
        {sends?.[0] && (
          <>
            <p style={{ color: MUTED }}>The first request ✨ Generate sends, word for word.</p>
            <SentPart label="System" text={sends[0].system} />
            <SentPart label="Prompt" text={sends[0].prompt} />
          </>
        )}
      </div>
    ) : undefined,
  };
}
