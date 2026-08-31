import React from 'react';
import type { GraphNode } from '../../types/graph';
import { generate } from '../../utils/api';
import { genAI } from '../../store/settingsStore';
import { useGenerate } from './useGenerate';
import { describeDataFormat } from '../data/dataElement';
import { ACCENT_FILL, ACCENT_TEXT, DIM, DIMMER, FIELD, FIELD_ON_SURFACE, MUTED, SUCCESS } from '../../ui/theme';

interface Props {
  node: GraphNode;
  setConfig: (key: string, value: unknown) => void;
  /** Data node(s) directly wired to this node's output, if any (see connectedOutputDataNodes). */
  connectedDataNodes?: GraphNode[];
}

const FORMAT_LABELS: Record<string, string> = {
  text: 'Plain text',
  json: 'JSON object / array',
  csv: 'CSV (rows as list of dicts)',
  csv_list: 'CSV (rows as list of lists)',
  custom: 'Custom (describe below)',
};

export default function OutputFormatEditor({ node, setConfig, connectedDataNodes = [] }: Props) {
  const format = node.config.output_format ?? 'text';
  const runGenerate = useGenerate();
  const generating = runGenerate.busy;
  const genMessage = runGenerate.message();

  // A downstream Data node's `data_format`/`data_format_prompt` already says
  // what shape this node's output must have -- copying it in beats asking the
  // user to redeclare the same contract a second time, one hop apart.
  const applyDataNodeFormat = (dataNode: GraphNode) => {
    if (dataNode.config.data_format === 'structure') {
      setConfig('output_format', 'custom');
      setConfig('output_format_prompt', dataNode.config.data_format_prompt ?? '');
    } else {
      setConfig('output_format', 'text');
    }
  };

  // The one generation that belongs to no element: an ai node and a code node
  // ask the identical question here, so it is requested by `kind` rather than
  // by element name. Its example is the element's one `example_file` -- this
  // panel used to carry a second attachment field of its own, which meant
  // attaching the same sample CSV twice to get it into both prompts.
  const handleGenerate = () => runGenerate.run({
    guard: () => (node.config.output_format_prompt || node.description)
      ? undefined
      : 'Please describe the desired format, or fill in the node description, first.',
    pending: 'Generating output format…',
    success: '✅ Format generated!',
    run: () => generate({
      kind: 'output_format',
      description: node.config.output_format_prompt || node.description,
      context_file: node.config.example_file,
      ...genAI(),
    }),
    apply: (result) => setConfig('output_format_prompt', result.result),
  });

  return (
    <div className="space-y-4">
      {connectedDataNodes.map((dataNode) => (
        <div
          key={dataNode.id}
          className="text-xs rounded-lg px-3 py-2 flex items-center justify-between gap-3"
          style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.25)', color: MUTED }}
        >
          <span>
            Wired to data node <strong style={{ color: ACCENT_TEXT }}>"{dataNode.label}"</strong>, which already
            defines: <em>{describeDataFormat(dataNode)}</em>
          </span>
          <button
            onClick={() => applyDataNodeFormat(dataNode)}
            className="shrink-0 text-xs px-2 py-1 rounded"
            style={{ background: SUCCESS, color: 'white' }}
          >
            Use this format
          </button>
        </div>
      ))}
      <div>
        <label className="block text-xs font-medium mb-1" style={{ color: MUTED }}>
          Expected output format
        </label>
        <p className="text-xs mb-2" style={{ color: DIM }}>
          This declaration is injected into AI code &amp; prompt generation so the model produces the correct format.
          It does not enforce or transform the actual value at runtime — add a Code node after this one for that.
        </p>
        <select
          className="w-full rounded-lg px-2 py-1.5 text-sm"
          style={FIELD_ON_SURFACE}
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
          <div className="flex items-center justify-between mb-1">
            <label className="block text-xs font-medium" style={{ color: MUTED }}>
              Custom format description
            </label>
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="text-xs px-2 py-1 rounded"
              style={{ background: SUCCESS, color: 'white', opacity: generating ? 0.5 : 1 }}
            >
              {generating ? '…' : '✨ Generate Output Format'}
            </button>
          </div>
          <textarea
            className="w-full rounded-lg px-2 py-1.5 text-sm font-mono resize-none"
            style={{ ...FIELD, minHeight: 80 }}
            value={node.config.output_format_prompt ?? ''}
            onChange={(e) => setConfig('output_format_prompt', e.target.value)}
            placeholder="e.g. A JSON array of objects with {title: string, score: number}"
          />
          <p className="text-xs mt-1" style={{ color: DIMMER }}>
            Describe the format above (or fill in the node description) and click ✨ Generate, or write it here directly — whatever is in this box is what's used.
          </p>
          {genMessage && (
            <div className="text-xs mt-1" style={{ color: MUTED }}>{genMessage}</div>
          )}
        </div>
      )}

      {format !== 'text' && (
        <div
          className="text-xs rounded-lg px-3 py-2"
          style={{ background: ACCENT_FILL, color: ACCENT_TEXT }}
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

