import React, { useState } from 'react';
import type { GraphNode } from '../../types/graph';
import GuiWidgetEditor from '../../components/GuiWidgetEditor';
import GuiDesigner from '../../components/gui/GuiDesigner';

interface GuiEditorProps {
  node: GraphNode;
  setConfig: (key: string, value: unknown) => void;
  applyWidgets: (widgets: GraphNode['config']['gui_widgets']) => void;
}

export default function GuiEditor({ node, setConfig, applyWidgets }: GuiEditorProps) {
  const [mode, setMode] = useState<'widgets' | 'designer'>('widgets');

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        {(['widgets', 'designer'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setMode(tab)}
            className="text-xs px-3 py-1.5 rounded-lg capitalize"
            style={{
              background: mode === tab ? '#6366f1' : '#2d3148',
              color: mode === tab ? 'white' : '#e2e8f0',
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      {mode === 'widgets' ? (
        <>
          <p className="text-xs mb-3" style={{ color: '#475569' }}>
            Ports are generated automatically from the widgets below.
            Adding, removing, or reordering a widget updates ports immediately.
          </p>

          <GuiWidgetEditor
            widgets={node.config.gui_widgets}
            onChange={applyWidgets}
            aiModel={node.config.gen_ai_model}
            aiProvider={node.config.gen_ai_provider}
          />
        </>
      ) : (
        <GuiDesigner
          widgets={node.config.gui_widgets}
          onChange={applyWidgets}
          columns={node.config.gui_grid_columns}
          rowHeight={node.config.gui_grid_row_height}
          onGridChange={(patch) => {
            if (patch.columns !== undefined) setConfig('gui_grid_columns', patch.columns);
            if (patch.rowHeight !== undefined) setConfig('gui_grid_row_height', patch.rowHeight);
          }}
        />
      )}
    </div>
  );
}
