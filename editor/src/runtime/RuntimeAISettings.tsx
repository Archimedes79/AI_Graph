import React, { useEffect, useState } from 'react';
import ProviderModelSelect from '../elements/shared/ProviderModelSelect';
import Modal from '../components/Modal';
import { getAISettings, saveAISettings } from '../utils/api';
import type { AIProvider } from '../types/graph';
import { errorText } from '../utils/errorText';
import { ACCENT_FILL, ACCENT_TEXT, DIM, DIMMER, FIELD, MUTED, NEUTRAL_BUTTON, PRIMARY_BUTTON } from '../ui/theme';

interface RuntimeAISettingsProps {
  onClose: () => void;
}

/**
 * "Point this tool at a different AI" -- once, at the machine that runs it.
 *
 * The deployed equivalent of the editor's runtime-AI setting, except it writes
 * `ai-settings.json` next to the executable instead of into the graph, so the
 * graph itself stays untouched and the choice survives restarts. Whoever
 * received the tool never has to open the graph, set an environment variable,
 * or know which of its nodes call an AI.
 */
export default function RuntimeAISettings({ onClose }: RuntimeAISettingsProps) {
  const [provider, setProvider] = useState<AIProvider>('default');
  const [model, setModel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [effective, setEffective] = useState<{ provider: string; model: string; settings_file: string } | null>(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  // Every edit invalidates a previous "✅ Saved": leaving it up while the user
  // switches provider or retypes a key tells them their change is stored when
  // it is not. Each setter below clears it.
  const edit = <T,>(set: (value: T) => void) => (value: T) => {
    setStatus('');
    set(value);
  };

  useEffect(() => {
    getAISettings()
      .then((data) => {
        setProvider((data.settings?.ai?.provider ?? 'default') as AIProvider);
        setModel(data.settings?.ai?.model ?? '');
        setBaseUrl(data.base_url ?? '');
        setApiKey(data.api_key ?? '');
        setEffective(data.effective);
      })
      .catch((error) => setStatus(`❌ ${errorText(error, 'Could not read settings')}`));
  }, []);

  const handleSave = async () => {
    setBusy(true);
    setStatus('Saving…');
    try {
      const result = await saveAISettings({ provider, model, base_url: baseUrl, api_key: apiKey });
      setEffective(result.effective);
      setStatus(`✅ Saved to ${result.path}`);
    } catch (error) {
      setStatus(`❌ ${errorText(error, 'Save failed')}`);
    } finally {
      setBusy(false);
    }
  };

  const needsEndpoint = provider === 'lmstudio' || provider === 'ollama' || provider === 'openai_compatible';
  const needsKey = provider === 'openai' || provider === 'anthropic' || provider === 'openai_compatible';

  return (
    <Modal
      title="⚙ AI Settings"
      onClose={onClose}
      maxWidth="max-w-xl"
      dismissOnBackdrop={!busy}
      dismissOnEscape={!busy}
      footer={
        <>
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs rounded-lg"
            style={NEUTRAL_BUTTON}
          >
            Close
          </button>
          <button
            onClick={handleSave}
            disabled={busy}
            className="px-3 py-1.5 text-xs rounded-lg font-semibold"
            style={{ ...PRIMARY_BUTTON, opacity: busy ? 0.6 : 1 }}
          >
            Save
          </button>
        </>
      }
    >
      <div className="p-5 space-y-4">
          <p className="text-xs" style={{ color: DIM }}>
            Which AI this tool calls. Set it once here — every AI step in the graph that was
            left on its default follows it.
          </p>

          <ProviderModelSelect
            provider={provider}
            model={model}
            onProviderChange={edit(setProvider)}
            onModelChange={edit(setModel)}
            allowDefault
            defaultLabel="Whatever the graph was built with"
          />

          {needsEndpoint && (
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: MUTED }}>
                Server address
              </label>
              <input
                className="w-full rounded-lg px-3 py-2 text-sm font-mono"
                style={FIELD}
                value={baseUrl}
                onChange={(e) => edit(setBaseUrl)(e.target.value)}
                placeholder={provider === 'ollama' ? 'http://localhost:11434' : 'http://localhost:1234/v1'}
              />
            </div>
          )}

          {needsKey && (
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: MUTED }}>
                API key
              </label>
              <input
                type="password"
                className="w-full rounded-lg px-3 py-2 text-sm font-mono"
                style={FIELD}
                value={apiKey}
                onChange={(e) => edit(setApiKey)(e.target.value)}
                placeholder="sk-…"
              />
              <p className="text-xs mt-1" style={{ color: DIMMER }}>
                Stored in the settings file next to this tool. An environment variable, if one
                is set, still takes precedence over it.
              </p>
            </div>
          )}

          {effective && (
            <div
              className="text-xs rounded-lg px-3 py-2"
              style={{ background: ACCENT_FILL, color: ACCENT_TEXT }}
            >
              Currently calling <strong>{effective.provider}</strong> / <strong>{effective.model}</strong>
              <div style={{ color: DIM }} className="mt-1 font-mono">{effective.settings_file}</div>
            </div>
          )}

        {status && <div className="text-xs" style={{ color: MUTED }}>{status}</div>}
      </div>
    </Modal>
  );
}
