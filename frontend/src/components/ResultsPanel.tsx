import React from 'react';
import { useGraphStore } from '../store/graphStore';

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
        background: '#1a1d2e',
        borderLeft: '1px solid #2d3148',
        flexShrink: 0,
      }}
    >
      <div className="px-4 py-3 border-b" style={{ borderColor: '#2d3148' }}>
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wider" style={{ color: '#6366f1' }}>
            Execution Results
          </h2>
          <span
            className="text-xs px-2 py-0.5 rounded font-medium"
            style={{
              background: result.status === 'success' ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
              color: result.status === 'success' ? '#86efac' : '#fca5a5',
            }}
          >
            {result.status}
          </span>
        </div>
        {result.duration_ms && (
          <p className="text-xs mt-1" style={{ color: '#475569' }}>
            {Math.round(result.duration_ms)}ms total
          </p>
        )}
      </div>

      {/* Final outputs */}
      {Object.keys(result.final_outputs).length > 0 && (
        <div className="px-4 py-3 border-b" style={{ borderColor: '#2d3148' }}>
          <h3 className="text-xs font-medium mb-2" style={{ color: '#94a3b8' }}>
            Final Outputs
          </h3>
          {Object.entries(result.final_outputs).map(([key, val]) => (
            <div key={key} className="mb-2">
              <span className="text-xs font-semibold" style={{ color: '#a5b4fc' }}>{key}</span>
              <pre
                className="text-xs mt-1 p-2 rounded overflow-auto"
                style={{ background: '#0f1117', color: '#e2e8f0', maxHeight: 120 }}
              >
                {typeof val === 'string' ? val : JSON.stringify(val, null, 2)}
              </pre>
            </div>
          ))}
        </div>
      )}

      {/* Top-level error */}
      {result.error && (
        <div className="px-4 py-3 border-b" style={{ borderColor: '#2d3148' }}>
          <div className="text-xs p-2 rounded" style={{ background: 'rgba(239,68,68,0.1)', color: '#fca5a5' }}>
            {result.error}
          </div>
        </div>
      )}

      {/* Node results */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        <h3 className="text-xs font-medium mb-2" style={{ color: '#94a3b8' }}>
          Node Results
        </h3>
        {result.node_results.map((nr) => (
          <div
            key={nr.node_id}
            className="mb-3 rounded-lg overflow-hidden"
            style={{ border: '1px solid #2d3148' }}
          >
            <div
              className="flex items-center justify-between px-3 py-2"
              style={{ background: '#0f1117' }}
            >
              <span className="text-xs font-medium" style={{ color: '#e2e8f0' }}>
                {nodeLabel(nr.node_id)}
              </span>
              <div className="flex items-center gap-2">
                {nr.duration_ms && (
                  <span className="text-xs" style={{ color: '#475569' }}>
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
                    color: nr.status === 'success' ? '#86efac' : '#fca5a5',
                  }}
                >
                  {nr.status}
                </span>
              </div>
            </div>
            {nr.error && (
              <div className="px-3 py-2 text-xs" style={{ color: '#fca5a5', background: 'rgba(239,68,68,0.05)' }}>
                {nr.error}
              </div>
            )}
            {Object.keys(nr.inputs ?? {}).length > 0 && (
              <div className="px-3 py-2" style={{ borderTop: '1px solid #2d3148' }}>
                <div className="text-xs font-medium mb-1" style={{ color: '#64748b' }}>Inputs</div>
                <pre
                  className="text-xs overflow-auto"
                  style={{ color: '#94a3b8', maxHeight: 100 }}
                >
                  {JSON.stringify(nr.inputs, null, 2)}
                </pre>
              </div>
            )}
            {nr.status === 'success' && Object.keys(nr.outputs).length > 0 && (
              <div className="px-3 py-2" style={{ borderTop: '1px solid #2d3148' }}>
                <div className="text-xs font-medium mb-1" style={{ color: '#64748b' }}>Outputs</div>
                <pre
                  className="text-xs overflow-auto"
                  style={{ color: '#94a3b8', maxHeight: 100 }}
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
