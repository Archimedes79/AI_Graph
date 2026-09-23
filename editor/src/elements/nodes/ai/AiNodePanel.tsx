import { useRef } from 'react';
import AuthoredBodyEditor from '@/authoring/AuthoredBodyEditor';
import { ACCENT_FILL, ACCENT_TEXT, DIMMER, FIELD, MUTED } from '@/ui/theme';
import PromptPreview from './PromptPreview';
import Step from '@/authoring/Step';
import type { NodePanelProps } from '../../NodeGuiBuilder';

/**
 * What someone writes for an ai node, in the order the request is built:
 * what it should do, the instructions that became, the message its inputs are
 * laid out in -- and then the request itself, as the model will read it.
 *
 * Everything that is a knob rather than a sentence lives in `AiNodeAdvancedPanel`,
 * folded away below: a node works without anyone opening it.
 */
export default function AiNodePanel({
  node, setConfig, generation, fields, generating, message, onGenerate,
  contextFile, onContextFileChange, steps,
}: NodePanelProps) {
  const template = useRef<HTMLTextAreaElement | null>(null);

  /** Put `{{port}}` where the cursor is, the way clicking a field name should. */
  const place = (portId: string) => {
    const box = template.current;
    const current = String(node.config.prompt_template ?? '');
    const token = `{{${portId}}}`;
    const at = box ? box.selectionStart : current.length;
    const end = box ? box.selectionEnd : current.length;
    setConfig('prompt_template', current.slice(0, at) + token + current.slice(end));
    requestAnimationFrame(() => {
      box?.focus();
      box?.setSelectionRange(at + token.length, at + token.length);
    });
  };

  // What an empty message means, spelled out: this node's inputs, one after
  // another (`assemblePrompt`). The placeholder used to be a chat template
  // from some other graph, with ports this node does not have.
  const laidOut = node.inputs.map((port) => `{{${port.id}}}`).join('\n\n');

  const messageBox = (
      <div>
        <div className="flex items-center justify-between mb-1 gap-3 flex-wrap">
          <label className="text-xs font-medium" style={{ color: MUTED }}>
            Message <span style={{ color: DIMMER }}>— how the inputs are laid out for the model. Left empty, they are sent one after another, as shown greyed out.</span>
          </label>
          <div className="flex items-center gap-1 flex-wrap">
            {node.inputs.map((port) => (
              <button
                key={port.id}
                onClick={() => place(port.id)}
                className="text-xs px-1.5 py-0.5 rounded font-mono"
                style={{ background: ACCENT_FILL, color: ACCENT_TEXT }}
                title={`Place the value of "${port.name || port.id}" here`}
              >
                {`{{${port.id}}}`}
              </button>
            ))}
          </div>
        </div>
        <textarea
          ref={template}
          className="w-full rounded-lg px-3 py-2 text-sm font-mono resize-y"
          style={{ ...FIELD, minHeight: 96 }}
          value={String(node.config.prompt_template ?? '')}
          onChange={(e) => setConfig('prompt_template', e.target.value)}
          placeholder={laidOut || 'Add an input above, then place it here as {{name}}.'}
          spellCheck={false}
          aria-label="Message template"
        />
      </div>
  );

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
        title={node.label}
        steps={steps && {
          ...steps,
          bodyHint: 'The instructions the model gets with every request. ✨ Generate writes them from steps 1 to 3; the answer format from step 3 is added after them by itself.',
        }}
      >
        {messageBox}
      </AuthoredBodyEditor>

      {steps
        ? <Step n={5} title="Try it" hint="Exactly what the model will receive, and its answer on sample values."><PromptPreview node={node} setConfig={setConfig} /></Step>
        : <PromptPreview node={node} setConfig={setConfig} />}
    </>
  );
}
