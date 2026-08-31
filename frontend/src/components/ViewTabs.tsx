import React from 'react';
import { useGraphStore } from '../store/graphStore';
import { NODE_ELEMENTS } from '../elements/registry';
import { ACCENT, DIMMER, LINE, MUTED, SURFACE } from '../ui/theme';

export type EditorView = 'graph' | 'design';

/**
 * Graph and interface, side by side as two views of one document.
 *
 * They are not two documents: the interface is derived from the graph's gui
 * nodes, so a block added here is a port added there. The tab exists because
 * designing a page inside a node's config dialog meant designing it through a
 * keyhole — and because the deployed tool *is* this page, so it deserves to be
 * looked at the way its user will.
 */
export default function ViewTabs({
  view, onChange,
}: { view: EditorView; onChange: (view: EditorView) => void }) {
  // How many blocks the interface has, so the tab says whether there is one.
  const blockCount = useGraphStore((s) => s.rfNodes
    .map((n) => n.data.graphNode)
    .filter((n) => NODE_ELEMENTS[n.node_type]?.hasRuntimeWindow)
    .reduce((total, n) => total + n.config.gui_widgets.length, 0));

  const tabs: { id: EditorView; label: string; hint: string }[] = [
    { id: 'graph', label: 'Graph', hint: 'Nodes und Verbindungen' },
    { id: 'design', label: 'Oberfläche', hint: 'Die Seite, die das Werkzeug zeigt' },
  ];

  return (
    <div className="flex items-center gap-1 px-3 flex-shrink-0" style={{ background: SURFACE, borderBottom: `1px solid ${LINE}` }}>
      {tabs.map((tab) => {
        const active = view === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            title={tab.hint}
            className="px-4 py-2 text-sm transition-colors"
            style={{
              color: active ? ACCENT : MUTED,
              borderBottom: active ? `2px solid ${ACCENT}` : '2px solid transparent',
              background: 'transparent',
            }}
          >
            {tab.label}
            {tab.id === 'design' && blockCount > 0 && (
              <span className="ml-2 text-xs" style={{ color: DIMMER }}>{blockCount}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
