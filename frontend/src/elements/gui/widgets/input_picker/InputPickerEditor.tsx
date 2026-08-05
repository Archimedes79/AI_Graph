import React, { useState } from 'react';
import type { GuiWidget } from '../../../../types/graph';
import { generateCode } from '../../../../utils/api';
import ProviderModelSelect from '../../../shared/ProviderModelSelect';

interface InputPickerEditorProps {
  widget: GuiWidget;
  onUpdate: (patch: Partial<GuiWidget>) => void;
}

export default function InputPickerEditor({ widget, onUpdate }: InputPickerEditorProps) {
  const mode = widget.mode || 'file';
  const [generating, setGenerating] = useState(false);
  const [genMessage, setGenMessage] = useState('');

  const handleGenerateSelectorCode = async () => {
    if (!widget.selector_prompt.trim()) {
      setGenMessage('Please describe which files to select first.');
      return;
    }
    setGenerating(true);
    setGenMessage('Generating file selector…');
    try {
      const result = await generateCode({
        description: widget.selector_prompt,
        language: widget.language || 'python',
        context: '`inputs["files"]` is the full list of rooted file paths found in the directory. Return only the selected paths as {"files": [...]}.',
        context_file: (widget.example_input_path ?? '').trim() || undefined,
        inputs: ['files'],
        outputs: ['files'],
        ai_model: widget.ai_model,
        ai_provider: widget.ai_provider,
      });
      onUpdate({ selector_code: result.code });
      setGenMessage('✅ Selector generated!');
    } catch (e: any) {
      setGenMessage(`❌ ${e?.response?.data?.detail ?? e?.message ?? 'Error'}`);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="space-y-2">
      <div>
        <label className="block text-xs font-medium mb-1" style={{ color: '#94a3b8' }}>Mode</label>
        <select
          className="w-full rounded-lg px-2 py-1.5 text-sm"
          style={{ background: '#1a1d2e', color: '#e2e8f0', border: '1px solid #2d3148' }}
          value={mode}
          onChange={(e) => onUpdate({ mode: e.target.value })}
        >
          <option value="file">Single file</option>
          <option value="directory">Directory (list of files)</option>
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium mb-1" style={{ color: '#94a3b8' }}>
          Default path
        </label>
        <input
          className="w-full rounded-lg px-2 py-1.5 text-sm"
          style={{ background: '#1a1d2e', color: '#e2e8f0', border: '1px solid #2d3148' }}
          value={typeof widget.value === 'string' ? widget.value : ''}
          onChange={(e) => onUpdate({ value: e.target.value })}
          placeholder={mode === 'directory' ? '/path/to/directory' : '/path/to/file'}
        />
      </div>
      {mode === 'directory' && (
        <>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: '#94a3b8' }}>
              File types (e.g. .md, .txt)
            </label>
            <input
              className="w-full rounded-lg px-2 py-1.5 text-sm"
              style={{ background: '#1a1d2e', color: '#e2e8f0', border: '1px solid #2d3148' }}
              value={widget.extensions ?? ''}
              onChange={(e) => onUpdate({ extensions: e.target.value })}
              placeholder="Leave empty for all file types"
            />
          </div>
          <label className="flex items-center gap-2 text-sm" style={{ color: '#94a3b8' }}>
            <input
              type="checkbox"
              checked={widget.recursive}
              onChange={(e) => onUpdate({ recursive: e.target.checked })}
            />
            Recursive
          </label>

          <div className="pt-2" style={{ borderTop: '1px solid #2d3148' }}>
            <label className="block text-xs font-medium mb-1" style={{ color: '#94a3b8' }}>
              Prompt text
            </label>
            <textarea
              className="w-full rounded-lg px-2 py-1.5 text-sm resize-none"
              style={{ background: '#1a1d2e', color: '#e2e8f0', border: '1px solid #2d3148', minHeight: 60 }}
              value={widget.selector_prompt}
              onChange={(e) => onUpdate({ selector_prompt: e.target.value })}
              placeholder="Select Markdown files that contain API documentation"
            />
            <div className="mt-2 mb-2">
              <label className="block text-xs font-medium mb-1" style={{ color: '#94a3b8' }}>
                Provider selection
              </label>
              <ProviderModelSelect
                provider={widget.ai_provider ?? 'ollama'}
                model={widget.ai_model ?? 'llama3'}
                onProviderChange={(provider) => onUpdate({ ai_provider: provider })}
                onModelChange={(model) => onUpdate({ ai_model: model })}
              />
            </div>
            <div className="mb-2">
              <label className="block text-xs font-medium mb-1" style={{ color: '#94a3b8' }}>
                Additional data (example input file, optional)
              </label>
              <input
                className="w-full rounded-lg px-2 py-1.5 text-sm font-mono"
                style={{ background: '#1a1d2e', color: '#e2e8f0', border: '1px solid #2d3148' }}
                value={widget.example_input_path ?? ''}
                onChange={(e) => onUpdate({ example_input_path: e.target.value })}
                placeholder="e:\\test\\data.csv"
              />
            </div>
            <div className="mb-2">
              <label className="block text-xs font-medium mb-1" style={{ color: '#94a3b8' }}>
                Language selection
              </label>
              <select
                className="w-full rounded-lg px-2 py-1.5 text-sm"
                style={{ background: '#1a1d2e', color: '#e2e8f0', border: '1px solid #2d3148' }}
                value={widget.language ?? 'python'}
                onChange={(e) => onUpdate({ language: e.target.value as 'python' | 'javascript' })}
              >
                <option value="python">Python</option>
                <option value="javascript">JavaScript</option>
              </select>
            </div>
            <label className="flex items-center gap-2 text-sm my-1" style={{ color: '#94a3b8' }}>
              <input
                type="checkbox"
                checked={widget.select_all_files}
                onChange={(e) => onUpdate({ select_all_files: e.target.checked })}
              />
              Select all files
            </label>
            {!widget.select_all_files && (
              <>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium" style={{ color: '#94a3b8' }}>
                    Code window (editable) — run(inputs) receives {'{'}"files"{'}'} and must return {'{'}"files"{'}'}
                  </label>
                  <button
                    onClick={handleGenerateSelectorCode}
                    disabled={generating}
                    className="text-xs px-2 py-1 rounded"
                    style={{ background: '#22c55e', color: 'white', opacity: generating ? 0.5 : 1 }}
                  >
                    {generating ? '…' : '✨ Generate'}
                  </button>
                </div>
                <textarea
                  className="w-full rounded-lg px-2 py-1.5 text-sm resize-none font-mono"
                  style={{ background: '#1a1d2e', color: '#e2e8f0', border: '1px solid #2d3148', minHeight: 100 }}
                  value={widget.selector_code}
                  onChange={(e) => onUpdate({ selector_code: e.target.value })}
                  spellCheck={false}
                />
                {genMessage && <p className="text-xs mt-1" style={{ color: '#94a3b8' }}>{genMessage}</p>}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

