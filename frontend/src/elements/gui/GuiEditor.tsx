import React, { useState } from 'react';
import type { GraphNode, GuiWidget } from '../../types/graph';
import GuiWidgetProperties from '../../components/GuiWidgetEditor';
import GuiDesigner from '../../components/gui/GuiDesigner';
import { LINE } from '../../ui/theme';

interface GuiEditorProps {
  node: GraphNode;
  setConfig: (key: string, value: unknown) => void;
  applyWidgets: (widgets: GraphNode['config']['gui_widgets']) => void;
}

/**
 * A gui node is designed on its canvas, not described in a list.
 *
 * There used to be a `widgets | designer` tab switch here, with the same widget
 * list editable in both -- and a third encoding of layout (the `size` preset)
 * on top. One canvas, one selection, one properties panel: adding a widget puts
 * it on the grid, selecting it shows what it is, and nothing but dragging
 * decides where it sits.
 */
export default function GuiEditor({ node, setConfig, applyWidgets }: GuiEditorProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const widgets = node.config.gui_widgets;
  const selected = widgets.find((w) => w.id === selectedId) ?? null;

  /** Patch the selected widget, found by its stable id rather than an index. */
  const updateSelected = (patch: Partial<GuiWidget>) => {
    if (!selected) return;
    applyWidgets(widgets.map((w) => (w.id === selected.id ? { ...w, ...patch } : w)));
  };

  return (
    <div>
      <GuiDesigner
        widgets={widgets}
        onChange={applyWidgets}
        columns={node.config.gui_grid_columns}
        onGridChange={(patch) => {
          if (patch.columns !== undefined) setConfig('gui_grid_columns', patch.columns);
        }}
        selectedId={selectedId}
        onSelect={setSelectedId}
      />

      {widgets.length > 0 && (
        <div className="mt-4 pt-4" style={{ borderTop: `1px solid ${LINE}` }}>
          <GuiWidgetProperties widget={selected} onChange={updateSelected} />
        </div>
      )}
    </div>
  );
}
