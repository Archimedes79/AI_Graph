import React from 'react';
import { useGraphStore } from '../store/graphStore';
import { ACCENT, ACCENT_TEXT, DANGER_TEXT, DIM, DIMMER, LINE, MUTED, SUNKEN, SURFACE, TEXT } from '../ui/theme';

export default function ResultsPanel() {
  const result = useGraphStore((s) => s.executionResult);
  const rfNodes = useGraphStore((s) => s.rfNodes);

  if (!result) return null;

  const nodeLabel = (id: string) =>
    rfNodes.find((n) => n.id === id)?.data.graphNode.label ?? id;

  return (
    <div
      className="flex flex-col overflow-y-auto"
      style={{
        width: 320,
        background: SURFACE,
        borderLeft: `1px solid ${LINE}`,
        flexShrink: 0,
      }}
    >
      <div className="px-4 py-3 border-b" style={{ borderColor: LINE }}>
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wider" style={{ color: ACCENT }}>
            Execution Results
          </h2>
          <span
            className="text-xs px-2 py-0.5 rounded font-medium"
            style={{
              background: result.status === 'success' ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
              color: result.status === 'success' ? '#86efac' : DANGER_TEXT,
            }}
          >
            {result.status}
          </span>
        </div>
        {result.duration_ms && (
          <p className="text-xs mt-1" style={{ color: DIMMER }}>
            {Math.round(result.duration_ms)}ms total
          </p>
        )}
      </div>

      {/* Final outputs */}
      {Object.keys(result.final_outputs).length > 0 && (
        <div className="px-4 py-3 border-b" style={{ borderColor: LINE }}>
          <h3 className="text-xs font-medium mb-2" style={{ color: MUTED }}>
            Final Outputs
          </h3>
          {Object.entries(result.final_outputs).map(([key, val]) => (
            <div key={key} className="mb-2">
              <span className="text-xs font-semibold" style={{ color: ACCENT_TEXT }}>{key}</span>
              <pre
                className="text-xs mt-1 p-2 rounded overflow-auto"
                style={{ background: SUNKEN, color: TEXT, maxHeight: 120 }}
              >
                {typeof val === 'string' ? val : JSON.stringify(val, null, 2)}
              </pre>
            </div>
          ))}
        </div>
      )}

      {/* Top-level error */}
      {result.error && (
        <div className="px-4 py-3 border-b" style={{ borderColor: LINE }}>
          <div className="text-xs p-2 rounded" style={{ background: 'rgba(239,68,68,0.1)', color: DANGER_TEXT }}>
            {result.error}
          </div>
        </div>
      )}

      {/* Node results */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        <h3 className="text-xs font-medium mb-2" style={{ color: MUTED }}>
          Node Results
        </h3>
        {result.node_results.map((nr) => (
          <div
            key={nr.node_id}
            className="mb-3 rounded-lg overflow-hidden"
            style={{ border: `1px solid ${LINE}` }}
          >
            <div
              className="flex items-center justify-between px-3 py-2"
              style={{ background: SUNKEN }}
            >
              <span className="text-xs font-medium" style={{ color: TEXT }}>
                {nodeLabel(nr.node_id)}
              </span>
              <div className="flex items-center gap-2">
                {nr.duration_ms && (
                  <span className="text-xs" style={{ color: DIMMER }}>
                    {Math.round(nr.duration_ms)}ms
                  </span>
                )}
                <span
                  className="text-xs px-1.5 py-0.5 rounded"
                  style={{
                    background:
                      nr.status === 'success'
                        ? 'rgba(34,197,94,0.15)'
                        : 'rgba(239,68,68,0.15)',
                    color: nr.status === 'success' ? '#86efac' : DANGER_TEXT,
                  }}
                >
                  {nr.status}
                </span>
              </div>
            </div>
            {nr.error && (
              <div className="px-3 py-2 text-xs" style={{ color: DANGER_TEXT, background: 'rgba(239,68,68,0.05)' }}>
                {nr.error}
              </div>
            )}
            {Object.keys(nr.inputs ?? {}).length > 0 && (
              <div className="px-3 py-2" style={{ borderTop: `1px solid ${LINE}` }}>
                <div className="text-xs font-medium mb-1" style={{ color: DIM }}>Inputs</div>
                <pre
                  className="text-xs overflow-auto"
                  style={{ color: MUTED, maxHeight: 100 }}
                >
                  {JSON.stringify(nr.inputs, null, 2)}
                </pre>
              </div>
            )}
            {nr.status === 'success' && Object.keys(nr.outputs).length > 0 && (
              <div className="px-3 py-2" style={{ borderTop: `1px solid ${LINE}` }}>
                <div className="text-xs font-medium mb-1" style={{ color: DIM }}>Outputs</div>
                <pre
                  className="text-xs overflow-auto"
                  style={{ color: MUTED, maxHeight: 100 }}
                >
                  {JSON.stringify(nr.outputs, null, 2)}
                </pre>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
