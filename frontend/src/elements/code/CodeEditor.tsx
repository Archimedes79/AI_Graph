import React from 'react';
import type { GraphNode } from '../../types/graph';
import ContextFileAttachment from '../shared/ContextFileAttachment';
import BatchAndFileInputOptions from '../shared/BatchAndFileInputOptions';
import CodeRequirements from './CodeRequirements';
import { suggestedCodeFileName } from './codeFileName';
import { DIMMER, FIELD, MUTED, SUCCESS } from '../../ui/theme';

interface CodeEditorProps {
  node: GraphNode;
  setConfig: (key: string, value: unknown) => void;
  generating: boolean;
  handleGenerateCode: () => void;
  contextFile: string;
  onContextFileChange: (path: string) => void;
}

export default function CodeEditor({
  node,
  setConfig,
  generating,
  handleGenerateCode,
  contextFile,
  onContextFileChange,
}: CodeEditorProps) {
  return (
    <>
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs font-medium" style={{ color: MUTED }}>
            Prompt text
          </label>
          <button
            onClick={handleGenerateCode}
            disabled={generating}
            className="text-xs px-2 py-1 rounded"
            style={{ background: SUCCESS, color: 'white', opacity: generating ? 0.5 : 1 }}
          >
            {generating ? '…' : '✨ Generate'}
          </button>
        </div>
        <textarea
          className="w-full rounded-lg px-3 py-2 text-sm resize-none"
          style={{ ...FIELD, minHeight: 120 }}
          value={node.config.code_prompt}
          onChange={(e) => setConfig('code_prompt', e.target.value)}
          placeholder="Describe what the generated code should do."
        />
      </div>

      <ContextFileAttachment
        label="Additional data (optional context file)"
        path={contextFile}
        onChange={onContextFileChange}
      />

      <div className="flex items-center gap-3">
        <label className="text-xs font-medium" style={{ color: MUTED }}>Language selection</label>
        <select
          className="rounded px-2 py-1 text-sm"
          style={FIELD}
          value={node.config.language}
          onChange={(e) => setConfig('language', e.target.value)}
        >
          <option value="python">Python</option>
          <option value="javascript">JavaScript</option>
        </select>
      </div>

      <div>
        <label className="block text-xs font-medium mb-1" style={{ color: MUTED }}>
          Code window (editable)
        </label>
        <textarea
          className="w-full rounded-lg px-3 py-2 text-sm resize-none font-mono"
          style={{ ...FIELD, minHeight: 220 }}
          value={node.config.code}
          onChange={(e) => setConfig('code', e.target.value)}
          placeholder={`def run(inputs):\n    return {"output": inputs.get("input", "")}`}
          spellCheck={false}
        />
      </div>

      <div>
        <label className="flex items-center gap-2 text-sm" style={{ color: MUTED }}>
          <input
            type="checkbox"
            checked={!!node.config.code_file}
            onChange={(e) => setConfig('code_file', e.target.checked ? suggestedCodeFileName(node) : '')}
          />
          Keep this code in a file beside the graph
        </label>
        <p className="text-xs mt-1" style={{ color: DIMMER }}>
          {node.config.code_file
            ? <>Saved as <span className="font-mono" style={{ color: MUTED }}>{'<graph>'}.nodes/{node.config.code_file}</span> — edit it in any editor; the graph reads it back when it opens. The file is named after this node, so renaming the node renames the file.</>
            : <>Off, so the code lives inside the graph JSON. Turning it on makes it a real .py/.js file you can open in VS Code, with a readable diff instead of an escaped JSON string.</>}
        </p>
      </div>

      <CodeRequirements
        requirements={node.config.requirements ?? []}
        onChange={(requirements) => setConfig('requirements', requirements)}
        language={node.config.language || 'python'}
      />

      <BatchAndFileInputOptions node={node} setConfig={setConfig} subject="code" />
    </>
  );
}
