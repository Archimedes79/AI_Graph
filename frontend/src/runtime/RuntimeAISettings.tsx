import React, { useEffect, useState } from 'react';
import ProviderModelSelect from '../elements/shared/ProviderModelSelect';
import { getAISettings, saveAISettings } from '../utils/api';
import type { AIProvider } from '../types/graph';

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

  useEffect(() => {
    getAISettings()
      .then((data) => {
        setProvider((data.settings?.ai?.provider ?? 'default') as AIProvider);
        setModel(data.settings?.ai?.model ?? '');
        setBaseUrl(data.base_url ?? '');
        setApiKey(data.api_key ?? '');
        setEffective(data.effective);
      })
      .catch((e: any) => setStatus(`❌ ${e?.response?.data?.detail ?? e?.message ?? 'Could not read settings'}`));
  }, []);

  const handleSave = async () => {
    setBusy(true);
    setStatus('Saving…');
    try {
      const result = await saveAISettings({ provider, model, base_url: baseUrl, api_key: apiKey });
      setEffective(result.effective);
      setStatus(`✅ Saved to ${result.path}`);
    } catch (e: any) {
      setStatus(`❌ ${e?.response?.data?.detail ?? e?.message ?? 'Save failed'}`);
    } finally {
      setBusy(false);
    }
  };

  const needsEndpoint = provider === 'lmstudio' || provider === 'ollama' || provider === 'openai_compatible';
  const needsKey = provider === 'openai' || provider === 'anthropic' || provider === 'openai_compatible';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.7)' }}
      onClick={onClose}
    >
      <div
        className="rounded-xl overflow-hidden shadow-2xl w-full max-w-xl mx-4"
        style={{ background: '#1a1d2e', border: '1px solid #2d3148' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between px-5 py-3"
          style={{ background: '#0f1117', borderBottom: '1px solid #2d3148' }}
        >
          <span className="text-sm font-semibold" style={{ color: '#e2e8f0' }}>⚙ AI Settings</span>
          <button onClick={onClose} style={{ color: '#94a3b8' }}>✕</button>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-xs" style={{ color: '#64748b' }}>
            Which AI this tool calls. Set it once here — every AI step in the graph that was
            left on its default follows it.
          </p>

          <ProviderModelSelect
            provider={provider}
            model={model}
            onProviderChange={setProvider}
            onModelChange={setModel}
            allowDefault
            defaultLabel="Whatever the graph was built with"
          />

          {needsEndpoint && (
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: '#94a3b8' }}>
                Server address
              </label>
              <input
                className="w-full rounded-lg px-3 py-2 text-sm font-mono"
                style={{ background: '#0f1117', color: '#e2e8f0', border: '1px solid #2d3148' }}
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder={provider === 'ollama' ? 'http://localhost:11434' : 'http://localhost:1234/v1'}
              />
            </div>
          )}

          {needsKey && (
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: '#94a3b8' }}>
                API key
              </label>
              <input
                type="password"
                className="w-full rounded-lg px-3 py-2 text-sm font-mono"
                style={{ background: '#0f1117', color: '#e2e8f0', border: '1px solid #2d3148' }}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-…"
              />
              <p className="text-xs mt-1" style={{ color: '#475569' }}>
                Stored in the settings file next to this tool. An environment variable, if one
                is set, still takes precedence over it.
              </p>
            </div>
          )}

          {effective && (
            <div
              className="text-xs rounded-lg px-3 py-2"
              style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)', color: '#a5b4fc' }}
            >
              Currently calling <strong>{effective.provider}</strong> / <strong>{effective.model}</strong>
              <div style={{ color: '#64748b' }} className="mt-1 font-mono">{effective.settings_file}</div>
            </div>
          )}

          {status && <div className="text-xs" style={{ color: '#94a3b8' }}>{status}</div>}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3" style={{ borderTop: '1px solid #2d3148' }}>
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs rounded-lg"
            style={{ background: '#2d3148', color: '#e2e8f0' }}
          >
            Close
          </button>
          <button
            onClick={handleSave}
            disabled={busy}
            className="px-3 py-1.5 text-xs rounded-lg font-semibold"
            style={{ background: '#6366f1', color: 'white', opacity: busy ? 0.6 : 1 }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
