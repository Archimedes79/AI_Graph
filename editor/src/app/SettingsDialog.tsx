import { useSettingsStore } from '@/store/settingsStore';
import { useGraphStore } from '@/store/graphStore';
import ProviderModelSelect from '@/elements/fields/ProviderModelSelect';
import AICredentialsSection from './AICredentialsSection';
import Modal from '@/ui/Modal';
import { ACCENT_FILL, ACCENT_TEXT, DANGER_TEXT, DIM, FIELD, PRIMARY_BUTTON, TEXT } from '@/ui/theme';
import { parseInterval } from '@engine/execution/triggers.ts';

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

  const triggers = metadata.triggers ?? {};
  const setTriggers = (patch: Partial<NonNullable<typeof metadata.triggers>>) =>
    setMetadata({ triggers: { ...triggers, ...patch } });
  // Said while it is being typed, in the engine's own words: the same function
  // reads this field when the graph runs, so what it rejects here it would
  // reject there -- at three in the morning, in a log nobody is reading.
  let intervalProblem = '';
  try {
    if ((triggers.every ?? '').trim()) parseInterval(triggers.every!);
  } catch (error) {
    intervalProblem = error instanceof Error ? error.message : String(error);
  }

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
              style={{ background: ACCENT_FILL, color: ACCENT_TEXT }}
            >
              When this graph is deployed, whoever runs it can point it somewhere else without
              editing it — <code>--ai-provider</code>/<code>--ai-model</code> on the command
              line, an <code>AI_GRAPH_AI_PROVIDER</code> environment variable, or an{' '}
              <code>ai-settings.json</code> next to the executable all take precedence over this.
            </div>
          </section>

          <section>
            <h3 className="text-sm font-semibold mb-1" style={{ color: TEXT }}>
              What starts this graph
            </h3>
            <p className="text-xs mb-3" style={{ color: DIM }}>
              Three things can. <strong>Something on its page</strong> — a button, a chat message, a
              dropdown told to — starts it at the node that block is wired to, and needs no setting
              here. The other two start the whole graph, and are saved with it
              as <code>metadata.triggers</code>:
            </p>
            <label className="flex items-center gap-2 text-sm mb-2" style={{ color: TEXT }}>
              <input
                type="checkbox"
                checked={triggers.on_start === true}
                onChange={(e) => setTriggers({ on_start: e.target.checked })}
              />
              When the tool is opened
            </label>
            <label className="flex items-center gap-2 text-sm" style={{ color: TEXT }}>
              <span>Again every</span>
              <input
                className="rounded-lg px-2 py-1 text-sm font-mono"
                style={{ ...FIELD, width: 90 }}
                value={triggers.every ?? ''}
                onChange={(e) => setTriggers({ every: e.target.value })}
                placeholder="never"
                aria-label="Interval"
              />
              <span className="text-xs" style={{ color: intervalProblem ? DANGER_TEXT : DIM }}>
                {intervalProblem || '45, 30s, 5m, 2h or 1d — counted from the end of one run to the start of the next'}
              </span>
            </label>
            <p className="text-xs mt-2" style={{ color: DIM }}>
              On the command line the same clock applies without a flag
              (<code>node engine/src/main.ts graph.json</code>); <code>--every</code> overrides it.
            </p>
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
