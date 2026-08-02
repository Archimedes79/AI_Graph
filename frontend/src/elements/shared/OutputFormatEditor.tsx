import React from 'react';
import type { GraphNode } from '../../types/graph';

interface Props {
  node: GraphNode;
  setConfig: (key: string, value: unknown) => void;
}

const FORMAT_LABELS: Record<string, string> = {
  text: 'Plain text',
  json: 'JSON object / array',
  csv: 'CSV (rows as list of dicts)',
  csv_list: 'CSV (rows as list of lists)',
  custom: 'Custom (describe below)',
};

export default function OutputFormatEditor({ node, setConfig }: Props) {
  const format = node.config.output_format ?? 'text';

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-medium mb-1" style={{ color: '#94a3b8' }}>
          Expected output format
        </label>
        <p className="text-xs mb-2" style={{ color: '#64748b' }}>
          This declaration is injected into AI code &amp; prompt generation so the model produces the correct format.
          It does not enforce or transform the actual value at runtime — add a Code node after this one for that.
        </p>
        <select
          className="w-full rounded-lg px-2 py-1.5 text-sm"
          style={{ background: '#1a1d2e', color: '#e2e8f0', border: '1px solid #2d3148' }}
          value={format}
          onChange={(e) => setConfig('output_format', e.target.value)}
        >
          {Object.entries(FORMAT_LABELS).map(([v, label]) => (
            <option key={v} value={v}>{label}</option>
          ))}
        </select>
      </div>

      {format === 'custom' && (
        <div>
          <label className="block text-xs font-medium mb-1" style={{ color: '#94a3b8' }}>
            Custom format description
          </label>
          <textarea
            className="w-full rounded-lg px-2 py-1.5 text-sm font-mono resize-none"
            style={{ background: '#0f1117', color: '#e2e8f0', border: '1px solid #2d3148', minHeight: 80 }}
            value={node.config.output_format_prompt ?? ''}
            onChange={(e) => setConfig('output_format_prompt', e.target.value)}
            placeholder="e.g. A JSON array of objects with {title: string, score: number}"
          />
        </div>
      )}

      {format !== 'text' && (
        <div
          className="text-xs rounded-lg px-3 py-2"
          style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)', color: '#a5b4fc' }}
        >
          <strong>Note:</strong> When generating code for this node, the AI will be instructed to produce{' '}
          <strong>{FORMAT_LABELS[format] ?? format}</strong>.
          {format === 'custom' && node.config.output_format_prompt && (
            <> Format spec: "{node.config.output_format_prompt}"</>
          )}
        </div>
      )}
    </div>
  );
}
