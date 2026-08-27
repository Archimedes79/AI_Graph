import React from 'react';
import type { GraphNode } from '../../types/graph';
import { GUI_WIDGET_ELEMENTS } from '../registry';
import { ACCENT_TEXT, DIM, MUTED, SUNKEN, TEXT, WELL } from '../../ui/theme';

interface Props {
  node: GraphNode;
}

function displayValue(value: unknown): string {
  if (value === undefined || value === null || value === '') return '(empty)';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * The `gui`/`widget` nodes' Output tab: each widget's output shape is fully
 * determined by its kind (see `GuiWidgetElementDefinition.ports`), so there is
 * nothing to configure here -- but "what does this widget actually output"
 * is still a real question with an easy answer, so this also shows the
 * widget's current stored value (`widget.value`, the same value its `{id}_out`
 * port emits on the next run) instead of type information alone.
 */
export default function WidgetOutputSummary({ node }: Props) {
  const widgets = node.config.gui_widgets ?? [];

  if (widgets.length === 0) {
    return (
      <p className="text-xs" style={{ color: DIM }}>
        No widgets yet — add one on the Config tab. Each widget's output shape is fixed by its kind, so there is nothing to configure here.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs" style={{ color: DIM }}>
        Each widget's output shape is fixed by its kind — nothing to configure here. The current
        value shown below is what its port will emit on the next run.
      </p>
      {widgets.map((widget) => {
        const { outputs } = GUI_WIDGET_ELEMENTS[widget.kind].ports(widget);
        return (
          <div
            key={widget.id}
            className="rounded-lg px-3 py-2 text-xs"
            style={WELL}
          >
            <div className="font-semibold mb-1" style={{ color: TEXT }}>
              {widget.label || widget.id} <span style={{ color: DIM }}>({widget.kind})</span>
            </div>
            {outputs.length === 0 ? (
              <div style={{ color: DIM }}>Display-only — no output port.</div>
            ) : (
              <>
                {outputs.map((port) => (
                  <div key={port.id} style={{ color: MUTED }}>
                    {port.name}: <span style={{ color: ACCENT_TEXT }}>{port.data_type}{port.multi ? '[]' : ''}</span>
                  </div>
                ))}
                <div
                  className="mt-1.5 px-2 py-1 rounded font-mono whitespace-pre-wrap break-words"
                  style={{ background: SUNKEN, color: TEXT, maxHeight: 96, overflowY: 'auto' }}
                >
                  {displayValue(widget.value)}
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
