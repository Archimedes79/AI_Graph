import { useEffect, useState } from 'react';
import type { GraphNode } from '@/graph';
import AuthoredBodyEditor from '@/authoring/AuthoredBodyEditor';
import { DANGER_SOFT, FIELD, LINE, MUTED, SUNKEN, TEXT } from '@/ui/theme';
import type { NodePanelProps } from '../../ElementUi';

function displayValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  return JSON.stringify(value, null, 2);
}

export default function DataNodePanel({
  node, setConfig, generation, fields, generating, message, onGenerate,
  applyDataFormat, contextFile, onContextFileChange,
}: NodePanelProps) {
  const [content, setContent] = useState(() => displayValue(node.config.data_value));
  const [contentError, setContentError] = useState('');
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
      <AuthoredBodyEditor
        generation={generation}
        fields={fields}
        exampleFile={contextFile}
        onExampleFileChange={onContextFileChange}
        generating={generating}
        message={message}
        onGenerate={onGenerate}
      >
        {/* Which family the contract belongs to is asked before it is written:
            it is what the generator is told, and what the ports are typed from. */}
        <div>
          <label className="block text-xs font-medium mb-1" style={{ color: MUTED }}>Standard data format</label>
          <select
            className="w-full rounded px-2 py-2 text-sm"
            style={FIELD}
            value={node.config.data_format}
            onChange={(event) => applyDataFormat(event.target.value as GraphNode['config']['data_format'])}
          >
            <option value="text">Text</option>
            <option value="structure">Structure (JSON)</option>
          </select>
        </div>
      </AuthoredBodyEditor>

      <div>
        <label className="block text-xs font-medium mb-1" style={{ color: MUTED }}>Stored content</label>
        <textarea
          className="w-full rounded-lg px-3 py-2 text-sm resize-none font-mono"
          style={{ background: SUNKEN, color: TEXT, border: `1px solid ${contentError ? DANGER_SOFT : LINE}`, minHeight: 160 }}
          value={content}
          onChange={(event) => updateContent(event.target.value)}
          spellCheck={false}
        />
        {contentError && <p className="text-xs mt-1" style={{ color: DANGER_SOFT }}>{contentError}</p>}
      </div>
    </>
  );
}
