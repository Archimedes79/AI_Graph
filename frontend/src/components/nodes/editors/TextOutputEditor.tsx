import React from 'react';
import type { GraphNode } from '../../../types/graph';

interface TextOutputEditorProps {
  node: GraphNode;
  setConfig: (key: string, value: unknown) => void;
}

export default function TextOutputEditor({ node, setConfig }: TextOutputEditorProps) {
  return (
    <div>
      <label className="block text-xs font-medium mb-1" style={{ color: '#94a3b8' }}>
        Window Title
      </label>
      <input
        className="w-full rounded-lg px-3 py-2 text-sm"
        style={{ background: '#0f1117', color: '#e2e8f0', border: '1px solid #2d3148' }}
        value={node.config.output_label}
        onChange={(e) => setConfig('output_label', e.target.value)}
      />
      <p className="text-xs mt-2" style={{ color: '#475569' }}>
        When the graph runs, the connected value is shown to the user in its own text
        window (in the editor, printed to the console for CLI runs, and for deployed
        runs).
      </p>
    </div>
  );
}
