import AuthoredBodyEditor from '@/authoring/AuthoredBodyEditor';
import NodeTryIt from '@/authoring/NodeTryIt';
import type { NodePanelProps } from '../../NodeUi';

export default function CodeNodePanel({
  node, generation, fields, generating, message, onGenerate,
  contextFile, onContextFileChange,
}: NodePanelProps) {
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
      />

      {/* The same loop an ai node has: what arrives, what I wrote, what comes out. */}
      <NodeTryIt node={node} title="Try it: what arrives, and what this code returns" />
    </>
  );
}
