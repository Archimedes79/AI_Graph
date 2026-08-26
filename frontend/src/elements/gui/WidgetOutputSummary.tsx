import React from 'react';
import type { GraphNode } from '../../types/graph';
import { GUI_WIDGET_ELEMENTS } from '../registry';

interface Props {
  node: GraphNode;
}

/**
 * The `gui`/`widget` nodes' Output tab: each widget's output shape is fully
 * determined by its kind (see `GuiWidgetElementDefinition.ports`), so there is
 * nothing for the user to configure here -- just a read-only summary computed
 * straight from the same `ports()` the graph uses to wire real ports.
 */
export default function WidgetOutputSummary({ node }: Props) {
  const widgets = node.config.gui_widgets ?? [];

  if (widgets.length === 0) {
    return (
      <p className="text-xs" style={{ color: '#64748b' }}>
        No widgets yet — add one on the Config tab. Each widget's output shape is fixed by its kind, so there is nothing to configure here.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs" style={{ color: '#64748b' }}>
        Each widget's output is fully determined by its kind — nothing to configure here.
      </p>
      {widgets.map((widget) => {
        const { outputs } = GUI_WIDGET_ELEMENTS[widget.kind].ports(widget);
        return (
          <div
            key={widget.id}
            className="rounded-lg px-3 py-2 text-xs"
            style={{ background: '#0f1117', border: '1px solid #2d3148' }}
          >
            <div className="font-semibold mb-1" style={{ color: '#e2e8f0' }}>
              {widget.label || widget.id} <span style={{ color: '#64748b' }}>({widget.kind})</span>
            </div>
            {outputs.length === 0 ? (
              <div style={{ color: '#64748b' }}>Display-only — no output port.</div>
            ) : (
              outputs.map((port) => (
                <div key={port.id} style={{ color: '#94a3b8' }}>
                  {port.name}: <span style={{ color: '#a5b4fc' }}>{port.data_type}{port.multi ? '[]' : ''}</span>
                </div>
              ))
            )}
          </div>
        );
      })}
    </div>
  );
}
