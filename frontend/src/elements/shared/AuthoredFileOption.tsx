import React from 'react';
import type { GraphNode } from '../../types/graph';
import { NODE_ELEMENTS } from '../registry';
import { suggestedFileName } from './authoredFileName';
import { DIMMER, MUTED } from '../../ui/theme';

interface AuthoredFileOptionProps {
  node: GraphNode;
  setConfig: (key: string, value: unknown) => void;
}

/**
 * "Keep this in a file beside the graph", for whichever node type offers it.
 *
 * Rendered once by NodeEditor rather than by each per-type ConfigEditor: every
 * element that authors something wants exactly this control with exactly this
 * behaviour, and the only thing that differs -- the extension and the noun --
 * comes from the element's own `authoredFile()`. A node type that authors
 * nothing renders nothing here without knowing this component exists.
 */
export default function AuthoredFileOption({ node, setConfig }: AuthoredFileOptionProps) {
  const spec = NODE_ELEMENTS[node.node_type]?.authoredFile?.(node);
  if (!spec) return null;

  const fileName = node.config.code_file ?? '';

  return (
    <div>
      <label className="flex items-center gap-2 text-sm" style={{ color: MUTED }}>
        <input
          type="checkbox"
          checked={!!fileName}
          onChange={(e) => setConfig('code_file', e.target.checked ? suggestedFileName(node.label, spec.extension) : '')}
        />
        Keep {spec.what} in a file beside the graph
      </label>
      <p className="text-xs mt-1" style={{ color: DIMMER }}>
        {fileName ? (
          <>
            Saved as <span className="font-mono" style={{ color: MUTED }}>{'<graph>'}.nodes/{fileName}</span> — edit it
            in any editor; the graph reads it back when it opens. The file is named after this node, so renaming the
            node renames the file.
          </>
        ) : (
          <>
            Off, so it lives inside the graph JSON. Turning it on makes it a real{' '}
            <span className="font-mono">{spec.extension}</span> file you can open in VS Code, with a readable diff
            instead of an escaped JSON string.
          </>
        )}
      </p>
    </div>
  );
}
