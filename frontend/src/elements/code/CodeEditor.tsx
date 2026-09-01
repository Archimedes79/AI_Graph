import React from 'react';
import type { GraphNode } from '../../types/graph';
import AuthoredBodyEditor from '../shared/AuthoredBodyEditor';
import BatchAndFileInputOptions from '../shared/BatchAndFileInputOptions';
import type { ElementGeneration, FieldAccess } from '../shared/generation';

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
      />

      <BatchAndFileInputOptions node={node} setConfig={setConfig} subject="code" />
    </>
  );
}
