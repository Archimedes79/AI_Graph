import AuthoredBodyEditor from '@/authoring/AuthoredBodyEditor';
import NodeTryIt from '@/authoring/NodeTryIt';
import Step from '@/authoring/Step';
import type { NodePanelProps } from '../../NodeGuiBuilder';

export default function CodeNodePanel({
  node, generation, fields, generating, message, onGenerate,
  contextFile, onContextFileChange, steps,
}: NodePanelProps) {
  const tryIt = <NodeTryIt node={node} title="Try it: what arrives, and what this code returns" />;
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
          bodyHint: 'A JavaScript function run(inputs) that returns the outputs. ✨ Generate writes it from steps 1 to 3, runs it on the last run\'s data, and repairs it once if it fails.',
        }}
      />

      {/* The same loop an ai node has: what arrives, what I wrote, what comes out. */}
      {steps ? <Step n={5} title="Try it" hint="Run this node alone on sample values, then keep what came out right as an example.">{tryIt}</Step> : tryIt}
    </>
  );
}
