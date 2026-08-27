import React, { useEffect, useId, useState } from 'react';
import type { AIProvider } from '../../types/graph';
import { getProviderStatus, type ProviderStatus } from '../../utils/api';
import { LINE, MUTED, SUNKEN, TEXT } from '../../ui/theme';

// Single source of truth for the provider dropdown -- previously duplicated
// verbatim in AIEditor.tsx, CodeEditor.tsx, and GuiWidgetEditor.tsx.
export const AI_PROVIDER_LABELS: Record<AIProvider, string> = {
  // Shown only where `allowDefault` is set; the caller supplies the wording,
  // because "default" means something different design-time (the server's
  // generation AI) than at runtime (the graph's own AI default).
  default: 'Default',
  ollama: 'Ollama (local)',
  lmstudio: 'LM Studio (local)',
  openai: 'OpenAI',
  openai_compatible: 'OpenAI-compatible endpoint',
  anthropic: 'Anthropic',
  github_copilot: 'GitHub Copilot (GitHub Models, needs GITHUB_TOKEN)',
};

// One probe per page load, shared by every mounted picker: the status answers
// "which local providers run, which models do they serve" for the whole
// editor, not per component instance.
let statusPromise: Promise<ProviderStatus | null> | null = null;
const fetchStatus = () => {
  if (!statusPromise) statusPromise = getProviderStatus().catch(() => null);
  return statusPromise;
};

export function useProviderStatus(): ProviderStatus | null {
  const [status, setStatus] = useState<ProviderStatus | null>(null);
  useEffect(() => {
    let mounted = true;
    fetchStatus().then((s) => { if (mounted) setStatus(s); });
    return () => { mounted = false; };
  }, []);
  return status;
}

interface ProviderModelSelectProps {
  provider: AIProvider;
  model: string;
  onProviderChange: (provider: AIProvider) => void;
  onModelChange: (model: string) => void;
  /** Tighter inline layout for a header row instead of a stacked grid. */
  compact?: boolean;
  /**
   * Offer the `default` provider -- "don't pin this, follow the configured
   * one". Off by default so a picker that must name a real provider cannot
   * accidentally offer it.
   */
  allowDefault?: boolean;
  /** Wording for the `default` option; required for it to read sensibly. */
  defaultLabel?: string;
}

export default function ProviderModelSelect({
  provider, model, onProviderChange, onModelChange, compact, allowDefault, defaultLabel,
}: ProviderModelSelectProps) {
  const status = useProviderStatus();
  const listId = useId();

  const annotate = (value: AIProvider, label: string) => {
    const local = status?.local?.[value];
    if (!local) return label;
    return local.reachable ? `${label} — ✓ running` : `${label} — not running`;
  };
  const options = (Object.entries(AI_PROVIDER_LABELS) as [AIProvider, string][])
    .filter(([value]) => value !== 'default' || allowDefault)
    .map(([value, label]) => [value, value === 'default' ? (defaultLabel ?? label) : annotate(value, label)] as const);

  // Models actually served by the selected local provider (or, for `default`,
  // by whatever it resolves to): pick-or-type via a datalist, because typing
  // an LM Studio model id from memory is exactly the friction this removes.
  const effectiveProvider = provider === 'default' ? status?.runtime_target?.provider : provider;
  const servedModels = (effectiveProvider && status?.local?.[effectiveProvider]?.models) || [];
  const placeholder = provider === 'default'
    ? (status?.runtime_target?.model || 'default model')
    : servedModels[0] ?? 'model name';

  const selectClass = compact ? 'rounded px-2 py-1 text-xs' : 'w-full rounded-lg px-3 py-2 text-sm';
  const inputClass = compact ? 'rounded px-2 py-1 text-xs w-24' : 'w-full rounded-lg px-3 py-2 text-sm';
  const style = { background: SUNKEN, color: TEXT, border: `1px solid ${LINE}` };

  const providerSelect = (
    <select className={selectClass} style={style} value={provider} onChange={(e) => onProviderChange(e.target.value as AIProvider)}>
      {options.map(([value, label]) => (
        <option key={value} value={value}>{label}</option>
      ))}
    </select>
  );
  const modelInput = (
    <>
      <input
        className={inputClass}
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

  if (compact) {
    return (
      <>
        {providerSelect}
        {modelInput}
      </>
    );
  }

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
