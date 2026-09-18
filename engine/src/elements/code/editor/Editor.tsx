import React from 'react';
import type { GraphNode } from '@/types/graph';
import AuthoredBodyEditor from '@/elements/shared/AuthoredBodyEditor';
import BatchAndFileInputOptions from '@/elements/shared/BatchAndFileInputOptions';
import NodeTryIt from '@/elements/shared/NodeTryIt';
import type { ElementGeneration, FieldAccess } from '@/elements/shared/generation';

interface CodeEditorProps {
  node: GraphNode;
  setConfig: (key: string, value: unknown) => void;
  generation: ElementGeneration<GraphNode>;
  fields: FieldAccess;
  generating: boolean;
  message?: string;
  onGenerate: () => void;
  contextFile: string;
  onContextFileChange: (path: string) => void;
}

export default function CodeEditor({
  node, setConfig, generation, fields, generating, message, onGenerate,
  contextFile, onContextFileChange,
}: CodeEditorProps) {
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

/** The switches with good defaults, folded away under the body: see `AdvancedEditor`. */
export function CodeAdvanced({ node, setConfig }: Pick<CodeEditorProps, 'node' | 'setConfig'>) {
  return <BatchAndFileInputOptions node={node} setConfig={setConfig} subject="code" />;
}
