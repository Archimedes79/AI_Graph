import { useEffect, useState } from 'react';
import type { AIProvider } from '@/graph';
import { call, type SettingsStatus } from '@/api/client';
import { errorText } from '@/api/errorText';
import ProviderModelSelect, { nowText, refreshProviderStatus, useProviderStatus } from '@/elements/fields/ProviderModelSelect';
import AICredentialsSection from './AICredentialsSection';
import Modal from '@/ui/Modal';
import { ACCENT_FILL, ACCENT_TEXT, DIM, PRIMARY_BUTTON, TEXT } from '@/ui/theme';

interface SettingsDialogProps {
  onClose: () => void;
}

/**
 * The one AI setting: which AI ✨ Generate, Try it and every run call,
 * wherever a node does not pin its own. This machine's, saved in
 * `ai-settings.json` beside the keys it needs and never in a graph, so a graph
 * handed to someone else runs on whatever they chose.
 *
 * "Now" is the engine's answer (`aiSetting`, through the status route), not
 * worked out here: it is what a run will call, environment and all.
 */
function OneAiSetting() {
  const status = useProviderStatus();
  const [saved, setSaved] = useState<SettingsStatus['ai'] | null>(null);
  const [draft, setDraft] = useState<{ provider: AIProvider; model: string }>({ provider: 'default', model: '' });
  const [message, setMessage] = useState('');

  const show = (ai: SettingsStatus['ai']) => {
    setSaved(ai);
    setDraft({ provider: (ai.provider || 'default') as AIProvider, model: ai.model });
  };

  useEffect(() => {
    call('aiSettings').then((data) => show(data.ai)).catch((e) => setMessage(errorText(e, 'Could not read the AI settings file.')));
  }, []);

  const changed = saved !== null && (draft.provider !== (saved.provider || 'default') || draft.model !== saved.model);

  const save = async () => {
    setMessage('');
    try {
      show((await call('saveAiSettings', { ai: draft })).ai);
      refreshProviderStatus();
      setMessage('Saved.');
    } catch (e) {
      setMessage(errorText(e, 'Could not save the AI settings file.'));
    }
  };

  return (
    <>
      <ProviderModelSelect
        provider={draft.provider}
        model={draft.model}
        onProviderChange={(provider) => setDraft((prev) => ({ ...prev, provider }))}
        onModelChange={(model) => setDraft((prev) => ({ ...prev, model }))}
        defaultLabel={() => 'Not set (a local model that is running, else Ollama)'}
      />
      <div className="flex items-center gap-3 mt-3 text-xs">
        <button
          className="px-2.5 py-1.5 rounded-lg"
          style={{ ...PRIMARY_BUTTON, opacity: changed ? 1 : 0.5 }}
          disabled={!changed}
          onClick={save}
        >
          Save
        </button>
        <span style={{ color: DIM }}>Now: <strong style={{ color: TEXT }}>{nowText(status)}</strong></span>
        {message && <span style={{ color: ACCENT_TEXT }}>{message}</span>}
      </div>
      {saved && saved.environment.length > 0 && (
        <div className="text-xs rounded-lg px-3 py-2 mt-3" style={{ background: ACCENT_FILL, color: ACCENT_TEXT }}>
          {saved.environment.map((variable, i) => <span key={variable}>{i > 0 && ' and '}<code>{variable}</code></span>)}{' '}
          {saved.environment.length > 1 ? 'are' : 'is'} set where the editor was started. That is the same
          setting, for a machine without this dialog, and it wins over what is saved here.
        </div>
      )}
    </>
  );
}

export default function SettingsDialog({ onClose }: SettingsDialogProps) {
  return (
    <Modal
      title="⚙ Settings"
      onClose={onClose}
      maxWidth="max-w-2xl"
      footer={
        <button
          onClick={onClose}
          className="px-3 py-1.5 text-xs rounded-lg font-semibold"
          style={PRIMARY_BUTTON}
        >
          Done
        </button>
      }
    >
      <div className="p-5 space-y-6">
          <section>
            <h3 className="text-sm font-semibold mb-1" style={{ color: TEXT }}>
              AI
            </h3>
            <p className="text-xs mb-3" style={{ color: DIM }}>
              What ✨ Generate, Try it and every run call — for each AI node left on
              “Use the setting in ⚙ Settings”, and for code that asks a model. A node that names
              its own provider and model always uses those instead. Saved on this machine in{' '}
              <code>ai-settings.json</code>, never in a graph: a graph you share runs on whatever
              its recipient set here.
            </p>
            <OneAiSetting />
          </section>

          <section>
            <h3 className="text-sm font-semibold mb-1" style={{ color: TEXT }}>
              What starts this graph
            </h3>
            <p className="text-xs" style={{ color: DIM }}>
              An event does, and it starts the graph at what it is wired to. <strong>Something on its
              page</strong> — a button, a chat message, a dropdown told to — is one.{' '}
              <strong>The tool starting</strong> and <strong>a clock</strong> are the other two: add
              a <strong>⏱️ Trigger</strong> node from the palette and wire it, or leave it unwired to
              start the whole graph.
            </p>
          </section>

          <section>
            <h3 className="text-sm font-semibold mb-1" style={{ color: TEXT }}>
              Keys and addresses
            </h3>
            <p className="text-xs mb-3" style={{ color: DIM }}>
              What the providers need in order to answer: the setting above, and any a node names.
            </p>
            <AICredentialsSection />
          </section>
      </div>
    </Modal>
  );
}
