import React from 'react';
import type { AIProvider } from '../../types/graph';

// Single source of truth for the provider dropdown -- previously duplicated
// verbatim in AIEditor.tsx, CodeEditor.tsx, and GuiWidgetEditor.tsx.
export const AI_PROVIDER_LABELS: Record<AIProvider, string> = {
  ollama: 'Ollama (local)',
  lmstudio: 'LM Studio (local)',
  openai: 'OpenAI',
  openai_compatible: 'OpenAI-compatible endpoint',
  anthropic: 'Anthropic',
  github_copilot: 'GitHub Copilot (GitHub Models, needs GITHUB_TOKEN)',
};

interface ProviderModelSelectProps {
  provider: AIProvider;
  model: string;
  onProviderChange: (provider: AIProvider) => void;
  onModelChange: (model: string) => void;
  /** Tighter inline layout for a header row instead of a stacked grid. */
  compact?: boolean;
}

export default function ProviderModelSelect({
  provider, model, onProviderChange, onModelChange, compact,
}: ProviderModelSelectProps) {
  const selectClass = compact ? 'rounded px-2 py-1 text-xs' : 'w-full rounded-lg px-3 py-2 text-sm';
  const inputClass = compact ? 'rounded px-2 py-1 text-xs w-24' : 'w-full rounded-lg px-3 py-2 text-sm';
  const style = { background: '#0f1117', color: '#e2e8f0', border: '1px solid #2d3148' };

  const providerSelect = (
    <select className={selectClass} style={style} value={provider} onChange={(e) => onProviderChange(e.target.value as AIProvider)}>
      {Object.entries(AI_PROVIDER_LABELS).map(([value, label]) => (
        <option key={value} value={value}>{label}</option>
      ))}
    </select>
  );
  const modelInput = (
    <input
      className={inputClass}
      style={style}
      value={model}
      onChange={(e) => onModelChange(e.target.value)}
      placeholder="llama3"
    />
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
        <label className="block text-xs font-medium mb-1" style={{ color: '#94a3b8' }}>Provider</label>
        {providerSelect}
      </div>
      <div>
        <label className="block text-xs font-medium mb-1" style={{ color: '#94a3b8' }}>Model</label>
        {modelInput}
      </div>
    </div>
  );
}
