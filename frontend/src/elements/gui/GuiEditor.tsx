import React from 'react';
import type { GraphNode } from '../../types/graph';
import { GUI_WIDGET_KIND_LABELS } from '../../utils/guiWidgets';
import { DIMMER, LINE, MUTED, TEXT } from '../../ui/theme';

interface GuiEditorProps {
  node: GraphNode;
  setConfig: (key: string, value: unknown) => void;
  applyWidgets: (widgets: GraphNode['config']['gui_widgets']) => void;
}

/**
 * A gui node's config panel: what this node contributes to the page, and where
 * the page is edited.
 *
 * Deliberately **not** a second designer. The interface is one page built from
 * every gui node's blocks, so it is designed in the Oberfläche tab -- at the
 * size it will really have, next to the blocks it will really sit beside.
 * Editing one list in two places is what this whole refactor kept removing:
 * first the `widgets | designer` switch inside this panel, then the `size`
 * preset that competed with the grid, and now the node-sized copy of the page.
 */
export default function GuiEditor({ node }: GuiEditorProps) {
  const widgets = node.config.gui_widgets;

  return (
    <div>
      <p className="text-sm mb-3" style={{ color: MUTED }}>
        Die Oberfläche wird im Tab <strong style={{ color: TEXT }}>Oberfläche</strong> gestaltet —
        auf einer Seite, zu der jeder GUI-Node seine Blöcke beisteuert.
      </p>

      {widgets.length === 0 ? (
        <p className="text-xs" style={{ color: DIMMER }}>Dieser Node steuert noch nichts bei.</p>
      ) : (
        <>
          <p className="text-xs mb-2" style={{ color: DIMMER }}>
            {widgets.length} {widgets.length === 1 ? 'Block' : 'Blöcke'} von diesem Node.
            Die Ports entstehen automatisch daraus.
          </p>
          <ul className="rounded-lg overflow-hidden" style={{ border: `1px solid ${LINE}` }}>
            {widgets.map((widget, index) => (
              <li
                key={widget.id}
                className="flex items-center justify-between px-3 py-2 text-sm"
                style={{ color: TEXT, borderTop: index === 0 ? 'none' : `1px solid ${LINE}` }}
              >
                <span className="truncate">{widget.label || GUI_WIDGET_KIND_LABELS[widget.kind]}</span>
                <span className="text-xs flex-shrink-0 ml-3" style={{ color: DIMMER }}>
                  {GUI_WIDGET_KIND_LABELS[widget.kind]} · {widget.w}×{widget.h}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
