import React from 'react';
import type { NodeType } from '../types/graph';
import { NODE_TYPE_DESCRIPTIONS, NODE_TYPE_ICON, NODE_TYPE_LABELS } from '../utils/nodeDefaults';
import { ACCENT, DIMMER, LINE, SURFACE, TEXT } from '../ui/theme';

const CATEGORIES: { label: string; types: NodeType[] }[] = [
  {
    // `input` had no palette entry at all: the node type existed, the editor
    // could load one, and there was no way to create one by hand. Every graph
    // that reads a file or a folder headlessly starts with it.
    label: 'Input',
    types: ['input'],
  },
  {
    label: 'Processing',
    types: ['data', 'ai', 'code'],
  },
  {
    label: 'Output',
    types: ['output'],
  },
  {
    label: 'Interactive',
    types: ['gui'],
  },
];

interface SidebarProps {
  onAddNode: (nodeType: NodeType) => void;
}

export default function Sidebar({ onAddNode }: SidebarProps) {
  return (
    <aside
      className="flex flex-col h-full overflow-y-auto"
      style={{
        width: 220,
        background: SURFACE,
        borderRight: `1px solid ${LINE}`,
        flexShrink: 0,
      }}
    >
      <div className="px-4 py-4 border-b" style={{ borderColor: LINE }}>
        <h2 className="text-xs font-semibold uppercase tracking-wider" style={{ color: ACCENT }}>
          Node Palette
        </h2>
        <p className="text-xs mt-1" style={{ color: DIMMER }}>
          Drag or click to add
        </p>
      </div>

      {CATEGORIES.map((cat) => (
        <div key={cat.label} className="py-3">
          <h3 className="px-4 text-xs font-medium uppercase tracking-wider mb-2" style={{ color: DIMMER }}>
            {cat.label}
          </h3>
          {cat.types.map((type) => (
            <button
              key={type}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left transition-colors hover-raise"
              style={{ color: TEXT }}
              onClick={() => onAddNode(type)}
              title={NODE_TYPE_DESCRIPTIONS[type]}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('application/nodeType', type);
                e.dataTransfer.effectAllowed = 'copy';
              }}
            >
              <span className="text-base">{NODE_TYPE_ICON[type]}</span>
              <span>{NODE_TYPE_LABELS[type]}</span>
            </button>
          ))}
        </div>
      ))}

      {/* No standalone widget entries any more. A gui node's blocks are added
          inside it, on its page -- four "widget nodes" dropped on the canvas
          produced exactly the interface one gui node with four blocks does,
          only with four extra boxes in the graph. They also taught the wrong
          model: a widget looked like a node type, which is the confusion that
          produced the retired `widget` node type in the first place. */}

      <div className="mt-auto px-4 py-4 border-t" style={{ borderColor: LINE }}>
        <p className="text-xs" style={{ color: DIMMER }}>
          Double-click a node to edit. Connect ports by dragging between handles.
        </p>
      </div>
    </aside>
  );
}
