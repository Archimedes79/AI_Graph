import React from 'react';
import { useSettingsStore } from '../store/settingsStore';
import { useGraphStore } from '../store/graphStore';
import ProviderModelSelect from '../elements/shared/ProviderModelSelect';
import AICredentialsSection from './AICredentialsSection';
import Modal from './Modal';
import { ACCENT_TEXT, DIM, PRIMARY_BUTTON, TEXT } from '../ui/theme';

interface SettingsDialogProps {
  onClose: () => void;
}

/**
 * The one place both AI choices are made.
 *
 * They are two genuinely different settings and the dialog says so:
 *
 *  - Code generation AI -- design time, this workstation, never saved into the
 *    graph (see store/settingsStore.ts).
 *  - Runtime AI default -- part of the graph (metadata.ai_defaults), used by
 *    every AI node left on "Use the graph's default", and overridable when the
 *    graph is deployed and run elsewhere.
 */
export default function SettingsDialog({ onClose }: SettingsDialogProps) {
  const genProvider = useSettingsStore((s) => s.genProvider);
  const genModel = useSettingsStore((s) => s.genModel);
  const setGenAI = useSettingsStore((s) => s.setGenAI);

  const metadata = useGraphStore((s) => s.metadata);
  const setMetadata = useGraphStore((s) => s.setMetadata);
  const aiDefaults = metadata.ai_defaults ?? { provider: 'default' as const, model: '' };

  const setAiDefaults = (patch: Partial<typeof aiDefaults>) =>
    setMetadata({ ai_defaults: { ...aiDefaults, ...patch } });

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
              Code generation AI
            </h3>
            <p className="text-xs mb-3" style={{ color: DIM }}>
              Used by every ✨ Generate action in the editor — code, system prompts, selector
              code, plot transforms, output formats and whole graphs. Set once here, for this
              browser; it is never saved into a graph, so a graph you share carries no model
              choice of yours.
            </p>
            <ProviderModelSelect
              provider={genProvider}
              model={genModel}
              onProviderChange={(provider) => setGenAI({ provider })}
              onModelChange={(model) => setGenAI({ model })}
              allowDefault
              defaultLabel="Server default (AI_GRAPH_GEN_PROVIDER / ai-settings.json)"
            />
          </section>

          <section>
            <h3 className="text-sm font-semibold mb-1" style={{ color: TEXT }}>
              Runtime AI default — for this graph
            </h3>
            <p className="text-xs mb-3" style={{ color: DIM }}>
              Which AI the graph's AI nodes call when they run. Every AI node left on
              “Use the graph's default” follows this, so a graph with eight AI nodes is
              configured once. Saved with the graph as <code>metadata.ai_defaults</code>.
            </p>
            <ProviderModelSelect
              provider={aiDefaults.provider}
              model={aiDefaults.model}
              onProviderChange={(provider) => setAiDefaults({ provider })}
              onModelChange={(model) => setAiDefaults({ model })}
              allowDefault
              defaultLabel="Unset (falls back to Ollama / llama3)"
            />
            <div
              className="text-xs rounded-lg px-3 py-2 mt-3"
              style={{ background: 'var(--gui-accent-fill, rgba(99,102,241,0.10))', border: '1px solid var(--gui-accent-fill, rgba(99,102,241,0.10))', color: ACCENT_TEXT }}
            >
              When this graph is deployed, whoever runs it can point it somewhere else without
              editing it — <code>--ai-provider</code>/<code>--ai-model</code> on the command
              line, an <code>AI_GRAPH_AI_PROVIDER</code> environment variable, or an{' '}
              <code>ai-settings.json</code> next to the executable all take precedence over this.
            </div>
          </section>

          <section>
            <h3 className="text-sm font-semibold mb-1" style={{ color: TEXT }}>
              Keys and addresses
            </h3>
            <p className="text-xs mb-3" style={{ color: DIM }}>
              What the providers above need in order to answer. Both choices draw on these,
              so a key entered once serves generation and execution alike.
            </p>
            <AICredentialsSection />
          </section>
      </div>
    </Modal>
  );
}
