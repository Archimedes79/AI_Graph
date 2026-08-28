import React, { useEffect, useState } from 'react';
import { getEditorAISettings, saveEditorAISettings, type AISettingsStatus } from '../utils/api';
import { errorText } from '../utils/errorText';
import { ACCENT_TEXT, DIM, DIMMER, FIELD, LINE, MUTED, NEUTRAL_BUTTON, PRIMARY_BUTTON, SUCCESS, TEXT } from '../ui/theme';

/** Providers that need a key, and the ones that need an address. */
const NEEDS_KEY = [
  { id: 'openai', label: 'OpenAI', hint: 'From platform.openai.com' },
  { id: 'anthropic', label: 'Anthropic', hint: 'From console.anthropic.com' },
  { id: 'google', label: 'Google Gemini', hint: 'Free key from aistudio.google.com/apikey' },
  { id: 'github_copilot', label: 'GitHub Models', hint: 'A GitHub token with the models:read scope' },
  { id: 'openai_compatible', label: 'OpenAI-compatible', hint: 'Whatever your endpoint expects' },
];

const NEEDS_ENDPOINT = [
  { id: 'ollama', label: 'Ollama', placeholder: 'http://localhost:11434' },
  { id: 'lmstudio', label: 'LM Studio', placeholder: 'http://localhost:1234/v1' },
  { id: 'openai_compatible', label: 'OpenAI-compatible', placeholder: 'https://my-endpoint.example.com/v1' },
  { id: 'google', label: 'Google Gemini', placeholder: 'https://generativelanguage.googleapis.com/v1beta/openai' },
];

/**
 * Where an API key actually goes.
 *
 * The dialog above this offers OpenAI, Anthropic and GitHub Models in its
 * dropdowns, but until this section existed it had no field for the credential
 * any of them need -- the key could only come from an environment variable or a
 * hand-written ai-settings.json the dialog never mentioned, so picking a hosted
 * provider silently produced a failure at the next ✨ Generate.
 *
 * Keys are write-only by design: the server reports whether one is set and where
 * it came from, never its value, so a key never travels back into the browser.
 */
export default function AICredentialsSection() {
  const [status, setStatus] = useState<AISettingsStatus | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [endpoints, setEndpoints] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getEditorAISettings()
      .then((data) => { setStatus(data); setEndpoints(data.endpoints); })
      .catch((e) => setMessage(errorText(e, 'Could not read the AI settings file.')));
  }, []);

  const persist = async (body: Parameters<typeof saveEditorAISettings>[0], note: string) => {
    setBusy(true);
    setMessage('');
    try {
      const data = await saveEditorAISettings(body);
      setStatus((prev) => (prev ? { ...prev, ...data } : prev));
      setEndpoints(data.endpoints);
      setDrafts({});
      setMessage(note);
    } catch (e) {
      setMessage(errorText(e, 'Could not save the AI settings file.'));
    } finally {
      setBusy(false);
    }
  };

  const saveKey = (provider: string) => {
    const value = (drafts[provider] ?? '').trim();
    if (!value) return;
    persist({ api_keys: { [provider]: value } }, 'Saved.');
  };

  if (!status) {
    return <p className="text-xs" style={{ color: DIM }}>{message || 'Loading…'}</p>;
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {NEEDS_KEY.map((provider) => {
          const state = status.credentials[provider.id];
          const configured = state?.configured;
          return (
            <div key={provider.id} className="flex items-center gap-2">
              <div style={{ width: 150 }} className="flex-shrink-0">
                <div className="text-xs font-medium" style={{ color: TEXT }}>{provider.label}</div>
                <div className="text-xs" style={{ color: configured ? SUCCESS : DIMMER }}>
                  {configured ? `key set (${state.source})` : 'no key'}
                </div>
              </div>
              <input
                type="password"
                className="flex-1 min-w-0 rounded-lg px-2 py-1.5 text-sm font-mono"
                style={FIELD}
                value={drafts[provider.id] ?? ''}
                onChange={(e) => setDrafts((prev) => ({ ...prev, [provider.id]: e.target.value }))}
                onKeyDown={(e) => { if (e.key === 'Enter') saveKey(provider.id); }}
                placeholder={configured ? 'Enter a new key to replace it' : provider.hint}
                autoComplete="off"
                aria-label={`${provider.label} API key`}
              />
              <button
                className="text-xs px-2.5 py-1.5 rounded-lg flex-shrink-0"
                style={{ ...PRIMARY_BUTTON, opacity: busy || !(drafts[provider.id] ?? '').trim() ? 0.5 : 1 }}
                disabled={busy || !(drafts[provider.id] ?? '').trim()}
                onClick={() => saveKey(provider.id)}
              >
                Save
              </button>
              {configured && state.source === 'settings file' && (
                <button
                  className="text-xs px-2 py-1.5 rounded-lg flex-shrink-0"
                  style={NEUTRAL_BUTTON}
                  disabled={busy}
                  onClick={() => persist({ clear_keys: [provider.id] }, 'Key removed.')}
                  title={`Remove the stored ${provider.label} key`}
                >
                  Clear
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div className="pt-3" style={{ borderTop: `1px solid ${LINE}` }}>
        <h4 className="text-xs font-semibold mb-2" style={{ color: TEXT }}>Server addresses</h4>
        <div className="space-y-2">
          {NEEDS_ENDPOINT.map((provider) => (
            <div key={provider.id} className="flex items-center gap-2">
              <span style={{ width: 150 }} className="flex-shrink-0 text-xs font-medium" >{provider.label}</span>
              <input
                className="flex-1 min-w-0 rounded-lg px-2 py-1.5 text-sm font-mono"
                style={FIELD}
                value={endpoints[provider.id] ?? ''}
                onChange={(e) => setEndpoints((prev) => ({ ...prev, [provider.id]: e.target.value }))}
                placeholder={provider.placeholder}
                aria-label={`${provider.label} server address`}
              />
            </div>
          ))}
        </div>
        <button
          className="text-xs px-2.5 py-1.5 rounded-lg mt-2"
          style={{ ...NEUTRAL_BUTTON, opacity: busy ? 0.5 : 1 }}
          disabled={busy}
          onClick={() => persist({ endpoints }, 'Addresses saved.')}
        >
          Save addresses
        </button>
      </div>

      <p className="text-xs" style={{ color: DIMMER }}>
        Stored in <span style={{ color: MUTED }} className="font-mono">{status.settings_file}</span>.
        An environment variable of the same name always wins over what is saved here.
      </p>

      {message && <p className="text-xs" style={{ color: ACCENT_TEXT }}>{message}</p>}
    </div>
  );
}
