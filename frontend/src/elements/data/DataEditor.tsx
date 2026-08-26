import React, { useEffect, useState } from 'react';
import type { GraphNode } from '../../types/graph';
import ContextFileAttachment from '../shared/ContextFileAttachment';

interface DataEditorProps {
  node: GraphNode;
  setConfig: (key: string, value: unknown) => void;
  generating: boolean;
  handleGenerateDataFormat: () => void;
  applyDataFormat: (format: GraphNode['config']['data_format']) => void;
  setDataDebugDirectory: (path: string) => void;
  contextFile: string;
  onContextFileChange: (path: string) => void;
}

function displayValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  return JSON.stringify(value, null, 2);
}

export default function DataEditor({
  node,
  setConfig,
  generating,
  handleGenerateDataFormat,
  applyDataFormat,
  setDataDebugDirectory,
  contextFile,
  onContextFileChange,
}: DataEditorProps) {
  const [content, setContent] = useState(() => displayValue(node.config.data_value));
  const [contentError, setContentError] = useState('');
  const debugDirectory = node.outputs.find((port) => port.id === 'output')?.debug_directory ?? '';
  const structured = node.config.data_format !== 'text';

  useEffect(() => setContent(displayValue(node.config.data_value)), [node.config.data_value]);

  const updateContent = (value: string) => {
    setContent(value);
    if (!structured) {
      setContentError('');
      setConfig('data_value', value);
      return;
    }
    try {
      setConfig('data_value', value.trim() ? JSON.parse(value) : null);
      setContentError('');
    } catch {
      setContentError('Structured data must be valid JSON before saving.');
    }
  };

  return (
    <>
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs font-medium" style={{ color: '#94a3b8' }}>Format generation prompt</label>
          <button
            onClick={handleGenerateDataFormat}
            disabled={generating}
            className="text-xs px-2 py-1 rounded"
            style={{ background: '#22c55e', color: 'white', opacity: generating ? 0.5 : 1 }}
          >
            {generating ? '…' : '✨ Generate'}
          </button>
        </div>
        <textarea
          className="w-full rounded-lg px-3 py-2 text-sm resize-none"
          style={{ background: '#0f1117', color: '#e2e8f0', border: '1px solid #2d3148', minHeight: 100 }}
          value={node.config.data_prompt}
          onChange={(event) => setConfig('data_prompt', event.target.value)}
          placeholder="Describe the records, fields, types, constraints, and examples this node stores."
        />
      </div>

      <ContextFileAttachment
        label="Example input (optional context file)"
        path={contextFile}
        onChange={onContextFileChange}
      />

      <div>
        <label className="block text-xs font-medium mb-1" style={{ color: '#94a3b8' }}>Standard data format</label>
        <select
          className="w-full rounded px-2 py-2 text-sm"
          style={{ background: '#0f1117', color: '#e2e8f0', border: '1px solid #2d3148' }}
          value={node.config.data_format}
          onChange={(event) => applyDataFormat(event.target.value as GraphNode['config']['data_format'])}
        >
          <option value="text">Text</option>
          <option value="structure">Structure (JSON)</option>
        </select>
      </div>

      <div>
        <label className="block text-xs font-medium mb-1" style={{ color: '#94a3b8' }}>Defined data format</label>
        <textarea
          className="w-full rounded-lg px-3 py-2 text-sm resize-none font-mono"
          style={{ background: '#0f1117', color: '#e2e8f0', border: '1px solid #2d3148', minHeight: 140 }}
          value={node.config.data_format_prompt}
          onChange={(event) => setConfig('data_format_prompt', event.target.value)}
          placeholder="Field names, types, dimensions, constraints, and a representative example."
        />
      </div>

      <div>
        <label className="block text-xs font-medium mb-1" style={{ color: '#94a3b8' }}>Stored content</label>
        <textarea
          className="w-full rounded-lg px-3 py-2 text-sm resize-none font-mono"
          style={{ background: '#0f1117', color: '#e2e8f0', border: `1px solid ${contentError ? '#f87171' : '#2d3148'}`, minHeight: 160 }}
          value={content}
          onChange={(event) => updateContent(event.target.value)}
          spellCheck={false}
        />
        {contentError && <p className="text-xs mt-1" style={{ color: '#f87171' }}>{contentError}</p>}
      </div>

      <div>
        <label className="block text-xs font-medium mb-1" style={{ color: '#94a3b8' }}>Temporary debug directory</label>
        <input
          className="w-full rounded-lg px-3 py-2 text-sm font-mono"
          style={{ background: '#0f1117', color: '#e2e8f0', border: '1px solid #2d3148' }}
          value={debugDirectory}
          onChange={(event) => setDataDebugDirectory(event.target.value)}
          placeholder="Leave empty to disable runtime snapshots"
        />
      </div>
    </>
  );
}