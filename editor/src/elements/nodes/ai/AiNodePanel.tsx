import { useRef } from 'react';
import NodeSteps from '@/authoring/NodeSteps';
import { promptText } from '@engine/elements/nodes/ai/prompt.ts';
import { ACCENT_FILL, ACCENT_TEXT, DIMMER, FIELD, MUTED, NEUTRAL_BUTTON, SUNKEN, TEXT } from '@/ui/theme';
import PromptPreview from './PromptPreview';
import { keptAnswer } from './keptAnswer';
import type { NodePanelProps } from '../../NodeGuiBuilder';

/**
 * An ai node: the four steps, its body the instructions the model gets, with
 * the message its inputs are laid out in beside them -- both are how the
 * request is written -- and, in Try it, that request as the model receives it
 * for the example, then its answer.
 *
 * Everything that is a knob rather than a sentence lives in `AiNodeAdvancedPanel`,
 * folded away below: a node works without anyone opening it.
 */
export default function AiNodePanel(props: NodePanelProps) {
  const { node, setConfig } = props;
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
          placeholder={laidOut || 'Add an input in step 1, then place it here as {{name}}.'}
          spellCheck={false}
          aria-label="Message template"
        />
      </div>
  );

  // What its step 2 keeps as an example: an answer the model is shown to
  // imitate, sent on every run -- never checked, as an answer is never the
  // same twice.
  const answerBox = (
    <>
      <div className="flex items-center justify-between mb-1 gap-3">
        <label className="text-xs font-medium" style={{ color: MUTED }}>Example answer</label>
        {node.config.output_example && (
          <button className="text-xs px-2 py-0.5 rounded" style={NEUTRAL_BUTTON} onClick={() => setConfig('output_example', '')}>Clear</button>
        )}
      </div>
      <p className="text-xs mb-1" style={{ color: DIMMER }}>
        Shown to the model on every run, to answer in the same shape with new content. Keep one from Try it below, or write it.
      </p>
      <textarea
        className="w-full rounded-lg px-2 py-1.5 text-sm font-mono resize-y"
        style={{ ...FIELD, minHeight: 56 }}
        value={String(node.config.output_example ?? '')}
        onChange={(event) => setConfig('output_example', event.target.value)}
        placeholder="An answer you liked"
        spellCheck={false}
        aria-label="Example answer"
      />
    </>
  );

  return (
    <NodeSteps
      {...props}
      subject="the model"
      wordsHint="Only needed when something reads the answer. Sent to the model after its instructions on every run, and to ✨ Generate here and in the nodes this one feeds."
      answer={{ field: answerBox, keep: (result) => setConfig('output_example', keptAnswer(node, result.outputs)) }}
      body={{
        title: 'Instructions',
        hint: 'What the model is told with every request, and the message its inputs are laid out in. ✨ Generate writes the instructions from steps 1 to 3; the words and the example answer of step 2 are added after them by themselves.',
        beside: messageBox,
      }}
      request={(example, graph) => <PromptPreview node={node} example={example} graph={graph} />}
      renderResult={(result) => (
        <pre className="text-xs rounded px-2 py-1.5 mt-1 whitespace-pre-wrap overflow-auto" style={{ background: SUNKEN, color: TEXT, maxHeight: 220 }}>
          {promptText(result.outputs?.output)}
        </pre>
      )}
    />
  );
}
