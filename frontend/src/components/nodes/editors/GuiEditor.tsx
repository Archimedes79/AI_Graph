import React from 'react';
import type { GraphNode } from '../../../types/graph';
import GuiWidgetEditor from '../../GuiWidgetEditor';

interface GuiEditorProps {
  node: GraphNode;
  applyWidgets: (widgets: GraphNode['config']['gui_widgets']) => void;
}

export default function GuiEditor({ node, applyWidgets }: GuiEditorProps) {
  return (
    <div>
      <p className="text-xs mb-3" style={{ color: '#475569' }}>
        Ports are generated automatically from the widgets below (see the Ports tab).
        Adding, removing, or reordering a widget updates ports immediately.
      </p>

      <GuiWidgetEditor
        widgets={node.config.gui_widgets}
        onChange={applyWidgets}
        aiModel={node.config.ai_model}
        aiProvider={node.config.ai_provider}
      />
    </div>
  );
}
