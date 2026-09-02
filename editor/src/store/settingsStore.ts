import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AIProvider } from '../types/graph';

/**
 * Editor-wide settings that are deliberately NOT part of a graph.
 *
 * Which AI writes your code and system prompts is a property of the
 * workstation doing the authoring: it never affects execution, it is the same
 * for every node, and a graph shared with a colleague should not carry your
 * model choice. So it lives here -- one setting, persisted in this browser --
 * instead of on every node's config (where `gen_ai_provider`/`gen_ai_model`
 * used to be) and on every GUI widget.
 *
 * The runtime AI a graph's `ai` nodes call is a different question with a
 * different home: `metadata.ai_defaults` inside the graph, overridable at run
 * time (see backend/app/services/ai_settings.py).
 *
 * `'default'` means "let the server decide" -- it resolves to
 * AI_GRAPH_GEN_PROVIDER / AI_GRAPH_GEN_MODEL, then ai-settings.json's
 * "codegen" section, then the runtime AI. That is the starting value so a
 * fresh browser follows however the backend was set up.
 */
export interface SettingsState {
  /** Provider for every design-time ✨ Generate action. */
  genProvider: AIProvider;
  /** Model for every design-time ✨ Generate action; '' -> the server's default. */
  genModel: string;
  setGenAI: (patch: { provider?: AIProvider; model?: string }) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      genProvider: 'default',
      genModel: '',
      setGenAI: (patch) =>
        set((state) => ({
          genProvider: patch.provider ?? state.genProvider,
          genModel: patch.model ?? state.genModel,
        })),
    }),
    { name: 'ai-graph.editor-settings' },
  ),
);

/**
 * The generation AI as request fields, read non-reactively.
 *
 * Every ✨ Generate call spreads this into its request body -- so there is
 * exactly one place in the editor that decides which AI generates, and
 * adding a new generate action cannot accidentally introduce a second
 * provider setting.
 */
export const genAI = (): { ai_provider: AIProvider; ai_model: string } => {
  const { genProvider, genModel } = useSettingsStore.getState();
  return { ai_provider: genProvider, ai_model: genModel };
};
