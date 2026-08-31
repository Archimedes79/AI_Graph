import React from 'react';
import { useGraphStore } from '../store/graphStore';
import { NODE_ELEMENTS } from '../elements/registry';
import { ACCENT, DIMMER, LINE, MUTED, SURFACE } from '../ui/theme';

export type EditorView = 'graph' | 'design' | 'preview';

/**
 * Graph and interface, side by side as two views of one document.
 *
 * They are not separate documents: the interface is derived from the graph's
 * gui nodes, so a block added there is a port added here. The design tab exists
 * because designing a page inside a node's config dialog meant designing it
 * through a keyhole.
 *
 * The third is the same page with the builder's affordances gone — literally
 * the component a deployed tool runs, not a rendition of it. A preview built
 * from its own code is a preview that can flatter; this one cannot, and it is
 * where you check what you are about to hand someone.
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
    { id: 'preview', label: 'Vorschau', hint: 'Genau das, was ausgeliefert läuft — ohne Bearbeiten' },
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
