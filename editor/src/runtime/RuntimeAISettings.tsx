import { useEffect, useState } from 'react';
import Modal from '../components/Modal';
import { call, type ToolAiSettings } from '../utils/api';
import { errorText } from '../utils/errorText';
import { ACCENT_FILL, ACCENT_TEXT, DIM, MUTED, NEUTRAL_BUTTON } from '../ui/theme';

/**
 * Which AI this tool calls, and where to change that.
 *
 * Read-only, and on purpose. Whoever runs a deployed tool configures it where
 * they run it -- `ai-settings.json` beside it, or the environment -- because a
 * page that wrote credentials would put a key in a file nobody asked for. The
 * dialog used to offer a Save that could never work: the server has no route
 * for it, and says why in `serve.ts`.
 */
export default function RuntimeAISettings({ onClose }: { onClose: () => void }) {
  const [settings, setSettings] = useState<ToolAiSettings | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    call('toolAiSettings').then(setSettings).catch((failure) => setError(errorText(failure, 'Could not read settings')));
  }, []);

  return (
    <Modal
      title="⚙ AI settings"
      onClose={onClose}
      maxWidth="max-w-xl"
      footer={<button onClick={onClose} className="px-3 py-1.5 text-xs rounded-lg" style={NEUTRAL_BUTTON}>Close</button>}
    >
      <div className="p-5 space-y-4 text-xs">
        {settings && (
          <div className="rounded-lg px-3 py-2" style={{ background: ACCENT_FILL, color: ACCENT_TEXT }}>
            This tool calls <strong>{settings.provider}</strong>{settings.model && <> / <strong>{settings.model}</strong></>}
            , wherever a step was left on its default.
          </div>
        )}
        <p style={{ color: DIM }}>
          To call a different AI, put an <code>ai-settings.json</code> beside the tool, or set{' '}
          <code>AI_GRAPH_AI_PROVIDER</code> and <code>AI_GRAPH_AI_MODEL</code> before starting it.
        </p>
        {settings && (
          <p style={{ color: MUTED }} className="font-mono break-all">
            {settings.settings_file} {settings.settings_file_exists ? '' : '(not there yet)'}
          </p>
        )}
        {error && <p style={{ color: MUTED }}>{error}</p>}
      </div>
    </Modal>
  );
}
