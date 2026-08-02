import React from 'react';
import type { NodeType } from '../types/graph';
import { NODE_TYPE_ICON, NODE_TYPE_LABELS, NODE_PRESETS, type NodePreset } from '../utils/nodeDefaults';

const CATEGORIES: { label: string; types: NodeType[] }[] = [
  {
    label: 'Inputs',
    types: ['text_input', 'file_input', 'directory_input'],
  },
  {
    label: 'Processing',
    types: ['ai', 'code', 'merge', 'split'],
  },
  {
    label: 'Output',
    types: ['output', 'text_output'],
  },
];

interface SidebarProps {
  onAddNode: (nodeType: NodeType) => void;
  onAddPreset: (preset: NodePreset) => void;
}

export default function Sidebar({ onAddNode, onAddPreset }: SidebarProps) {
  return (
    <aside
      className="flex flex-col h-full overflow-y-auto"
      style={{
        width: 220,
        background: '#1a1d2e',
        borderRight: '1px solid #2d3148',
        flexShrink: 0,
      }}
    >
      <div className="px-4 py-4 border-b" style={{ borderColor: '#2d3148' }}>
        <h2 className="text-xs font-semibold uppercase tracking-wider" style={{ color: '#6366f1' }}>
          Node Palette
        </h2>
        <p className="text-xs mt-1" style={{ color: '#475569' }}>
          Drag or click to add
        </p>
      </div>

      {CATEGORIES.map((cat) => (
        <div key={cat.label} className="py-3">
          <h3 className="px-4 text-xs font-medium uppercase tracking-wider mb-2" style={{ color: '#475569' }}>
            {cat.label}
          </h3>
          {cat.types.map((type) => (
            <button
              key={type}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left transition-colors hover:bg-white/5"
              style={{ color: '#e2e8f0' }}
              onClick={() => onAddNode(type)}
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

      <div className="py-3">
        <h3 className="px-4 text-xs font-medium uppercase tracking-wider mb-2" style={{ color: '#475569' }}>
          File Parsing
        </h3>
        {NODE_PRESETS.map((preset) => (
          <button
            key={preset.id}
            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left transition-colors hover:bg-white/5"
            style={{ color: '#e2e8f0' }}
            onClick={() => onAddPreset(preset)}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData('application/nodePreset', preset.id);
              e.dataTransfer.effectAllowed = 'copy';
            }}
            title={preset.description}
          >
            <span className="text-base">{preset.icon}</span>
            <span>{preset.label}</span>
          </button>
        ))}
      </div>

      <div className="mt-auto px-4 py-4 border-t" style={{ borderColor: '#2d3148' }}>
        <p className="text-xs" style={{ color: '#475569' }}>
          Double-click a node to edit. Connect ports by dragging between handles.
        </p>
      </div>
    </aside>
  );
}
