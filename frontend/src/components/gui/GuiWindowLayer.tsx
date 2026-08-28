import React, { useState } from 'react';
import { useGraphStore } from '../../store/graphStore';
import GuiWindow from './GuiWindow';
import { FIELD_ON_SURFACE } from '../../ui/theme';

/** Mounts one runtime `GuiWindow` per `gui`/`widget` node, plus pills to reopen closed ones. */
export default function GuiWindowLayer() {
  const rfNodes = useGraphStore((s) => s.rfNodes);
  const [closed, setClosed] = useState<string[]>([]);

  const guiNodes = rfNodes
    .map((n) => n.data.graphNode)
    .filter((n) => n.node_type === 'gui');

  const openNodes = guiNodes.filter((n) => !closed.includes(n.id));
  const closedNodes = guiNodes.filter((n) => closed.includes(n.id));

  return (
    <>
      {openNodes.map((node, i) => (
        <GuiWindow
          key={node.id}
          node={node}
          index={i}
          onClose={() => setClosed((prev) => [...prev, node.id])}
        />
      ))}

      {closedNodes.length > 0 && (
        <div className="fixed z-40 flex flex-wrap gap-2" style={{ bottom: 16, left: 16 }}>
          {closedNodes.map((node) => (
            <button
              key={node.id}
              onClick={() => setClosed((prev) => prev.filter((id) => id !== node.id))}
              className="px-3 py-1.5 text-xs rounded-lg shadow-lg"
              style={FIELD_ON_SURFACE}
            >
              🖥️ {node.label}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
