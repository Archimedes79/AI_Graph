import React from 'react';
import { useSettingsStore } from '../store/settingsStore';
import { useGraphStore } from '../store/graphStore';
import ProviderModelSelect from '../elements/shared/ProviderModelSelect';

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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.7)' }}
      onClick={onClose}
    >
      <div
        className="rounded-xl overflow-hidden shadow-2xl w-full max-w-2xl mx-4"
        style={{ background: '#1a1d2e', border: '1px solid #2d3148' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between px-5 py-3"
          style={{ background: '#0f1117', borderBottom: '1px solid #2d3148' }}
        >
          <span className="text-sm font-semibold" style={{ color: '#e2e8f0' }}>⚙ Settings</span>
          <button onClick={onClose} style={{ color: '#94a3b8' }}>✕</button>
        </div>

        <div className="p-5 space-y-6">
          <section>
            <h3 className="text-sm font-semibold mb-1" style={{ color: '#e2e8f0' }}>
              Code generation AI
            </h3>
            <p className="text-xs mb-3" style={{ color: '#64748b' }}>
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
            <h3 className="text-sm font-semibold mb-1" style={{ color: '#e2e8f0' }}>
              Runtime AI default — for this graph
            </h3>
            <p className="text-xs mb-3" style={{ color: '#64748b' }}>
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
              style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)', color: '#a5b4fc' }}
            >
              When this graph is deployed, whoever runs it can point it somewhere else without
              editing it — <code>--ai-provider</code>/<code>--ai-model</code> on the command
              line, an <code>AI_GRAPH_AI_PROVIDER</code> environment variable, or an{' '}
              <code>ai-settings.json</code> next to the executable all take precedence over this.
            </div>
          </section>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3" style={{ borderTop: '1px solid #2d3148' }}>
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs rounded-lg font-semibold"
            style={{ background: '#6366f1', color: 'white' }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
