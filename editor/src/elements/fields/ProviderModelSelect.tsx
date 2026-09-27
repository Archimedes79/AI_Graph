import { useEffect, useId, useState } from 'react';
import type { AIProvider } from '@/graph';
import { call, type ProviderStatus } from '@/api/client';
import { LINE, MUTED, SUNKEN, TEXT } from '@/ui/theme';
import { lent } from '@engine/elements/Runtime.ts';

// Single source of truth for the provider dropdown -- previously duplicated
// verbatim in AiNodePanel.tsx, CodeNodePanel.tsx, and WidgetEditor.tsx.
export const AI_PROVIDER_LABELS: Record<AIProvider, string> = {
  // Shown only where the caller names it (`defaultLabel`): on a node it is the
  // one AI setting, in ⚙ Settings it is that setting left unset.
  default: 'Default',
  ollama: 'Ollama (local)',
  lmstudio: 'LM Studio (local)',
  openai: 'OpenAI',
  openai_compatible: 'OpenAI-compatible endpoint',
  anthropic: 'Anthropic',
  google: 'Google Gemini',
  github_copilot: 'GitHub Models',
};

/**
 * What each provider costs to use, shown in the picker.
 *
 * The tool is usable for nothing -- a local model, or a hosted free tier -- and
 * that was invisible: the list read as seven equivalent choices, so the one
 * question a newcomer actually has ("which of these will bill me?") had no
 * answer on screen. Deliberately no numbers: free-tier limits change, and a
 * stale figure in a dropdown is worse than none.
 */
const AI_PROVIDER_COST: Record<AIProvider, string> = {
  default: '',
  ollama: 'free, local',
  lmstudio: 'free, local',
  openai: 'paid',
  openai_compatible: 'depends on the endpoint',
  anthropic: 'paid',
  google: 'free tier',
  github_copilot: 'free tier',
};

// One probe shared by every mounted picker: the status answers "which local
// providers run, which models do they serve, what is the one AI setting now"
// for the whole editor, not per component instance.
let statusPromise: Promise<ProviderStatus | null> | null = null;
const listeners = new Set<(status: ProviderStatus | null) => void>();
const fetchStatus = () => {
  if (!statusPromise) statusPromise = call('providers').catch(() => null);
  return statusPromise;
};

/** Ask the engine again: after the one AI setting is saved, every picker's "now" is stale. */
export function refreshProviderStatus(): void {
  statusPromise = null;
  fetchStatus().then((status) => listeners.forEach((listener) => listener(status)));
}

/** The engine's answer to what runs where: the one AI setting as it resolves now, and the local providers. */
export function useProviderStatus(): ProviderStatus | null {
  const [status, setStatus] = useState<ProviderStatus | null>(null);
  useEffect(() => {
    let mounted = true;
    fetchStatus().then((s) => { if (mounted) setStatus(s); });
    listeners.add(setStatus);
    return () => { mounted = false; listeners.delete(setStatus); };
  }, []);
  return status;
}

/** The one AI setting as a person reads it: `provider / model`. */
export const nowText = (status: ProviderStatus | null): string =>
  status ? `${status.target.provider} / ${status.target.model || 'no model'}` : '…';

/**
 * What the model box offers: the models served by the provider chosen -- for
 * `default`, by the one AI setting -- and what it shows while empty.
 *
 * On a node (`lendsFromSetting`) an empty model is filled by the engine's own
 * rule (`lent`) from the one setting, and only for the provider it names: left
 * empty with nothing to fill it, a run refuses, so the box says a model must
 * be named rather than showing one a run would never send. The setting itself
 * left empty takes the provider's own default.
 */
export function modelHints(
  provider: AIProvider, status: ProviderStatus | null, { lendsFromSetting }: { lendsFromSetting?: boolean } = {},
): { servedModels: string[]; placeholder: string } {
  const now = status?.target;
  const effectiveProvider = provider === 'default' ? now?.provider : provider;
  const servedModels = (effectiveProvider && status?.local?.[effectiveProvider]?.models) || [];
  if (lendsFromSetting && now) {
    const lentModel = lent({ provider, model: '' }, now).model;
    return {
      servedModels,
      placeholder: lentModel || (servedModels[0] ? `required, e.g. ${servedModels[0]}` : 'required: name a model'),
    };
  }
  const own = now && (provider === 'default' || provider === now.provider) ? now.model : servedModels[0];
  return { servedModels, placeholder: own || 'its default model' };
}

interface ProviderModelSelectProps {
  provider: AIProvider;
  model: string;
  onProviderChange: (provider: AIProvider) => void;
  onModelChange: (model: string) => void;
  /**
   * Offers the `default` provider, called what this returns, handed the one AI
   * setting as it is now. Left out, a real provider must be named.
   */
  defaultLabel?: (now: string) => string;
  /** An empty model is filled from the one AI setting, as a node's is: see `modelHints`. */
  lendsFromSetting?: boolean;
}

export default function ProviderModelSelect({
  provider, model, onProviderChange, onModelChange, defaultLabel, lendsFromSetting,
}: ProviderModelSelectProps) {
  const status = useProviderStatus();
  const listId = useId();

  const annotate = (value: AIProvider, label: string) => {
    const cost = AI_PROVIDER_COST[value];
    const local = status?.local?.[value];
    // For a local provider, whether it is actually up is the more useful half.
    const detail = local ? (local.reachable ? '✓ running' : 'not running') : cost;
    return detail ? `${label} — ${detail}` : label;
  };
  const options = (Object.entries(AI_PROVIDER_LABELS) as [AIProvider, string][])
    .filter(([value]) => value !== 'default' || defaultLabel)
    .map(([value, label]) => [value, value === 'default' ? defaultLabel!(nowText(status)) : annotate(value, label)] as const);

  // Models actually served by the selected local provider (or, for `default`,
  // by whatever it resolves to): pick-or-type via a datalist, because typing
  // an LM Studio model id from memory is exactly the friction this removes.
  const { servedModels, placeholder } = modelHints(provider, status, { lendsFromSetting });

  const boxClass = 'w-full rounded-lg px-3 py-2 text-sm';
  const style = { background: SUNKEN, color: TEXT, border: `1px solid ${LINE}` };

  const providerSelect = (
    <select className={boxClass} style={style} value={provider} onChange={(e) => onProviderChange(e.target.value as AIProvider)}>
      {options.map(([value, label]) => (
        <option key={value} value={value}>{label}</option>
      ))}
    </select>
  );
  const modelInput = (
    <>
      <input
        className={boxClass}
        style={style}
        value={model}
        onChange={(e) => onModelChange(e.target.value)}
        placeholder={placeholder}
        list={servedModels.length ? listId : undefined}
      />
      {servedModels.length > 0 && (
        <datalist id={listId}>
          {servedModels.map((m) => <option key={m} value={m} />)}
        </datalist>
      )}
    </>
  );

  return (
    <div className="grid grid-cols-2 gap-4">
      <div>
        <label className="block text-xs font-medium mb-1" style={{ color: MUTED }}>Provider</label>
        {providerSelect}
      </div>
      <div>
        <label className="block text-xs font-medium mb-1" style={{ color: MUTED }}>Model</label>
        {modelInput}
      </div>
    </div>
  );
}
