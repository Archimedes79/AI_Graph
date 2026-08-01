import React, { useState } from 'react';
import { useGraphStore } from '../store/graphStore';
import { executeGraph, downloadBundle, getDockerCompose } from '../utils/api';

interface ToolbarProps {
  onNewGraph: () => void;
  onSave: () => void;
  onLoad: () => void;
}

export default function Toolbar({ onNewGraph, onSave, onLoad }: ToolbarProps) {
  const metadata = useGraphStore((s) => s.metadata);
  const setMetadata = useGraphStore((s) => s.setMetadata);
  const isExecuting = useGraphStore((s) => s.isExecuting);
  const setIsExecuting = useGraphStore((s) => s.setIsExecuting);
  const setExecutionResult = useGraphStore((s) => s.setExecutionResult);
  const exportGraph = useGraphStore((s) => s.exportGraph);
  const executionResult = useGraphStore((s) => s.executionResult);

  const [showDeploy, setShowDeploy] = useState(false);
  const [deployContent, setDeployContent] = useState('');
  const [deployLabel, setDeployLabel] = useState('');

  const handleRun = async () => {
    setIsExecuting(true);
    setExecutionResult(null);
    try {
      const graph = exportGraph();
      const result = await executeGraph(graph);
      setExecutionResult(result);
    } catch (e: any) {
      setExecutionResult({
        status: 'error',
        node_results: [],
        final_outputs: {},
        error: e?.response?.data?.detail ?? e?.message ?? 'Execution failed',
      });
    } finally {
      setIsExecuting(false);
    }
  };

  const handleDownloadBundle = async () => {
    const graph = exportGraph();
    await downloadBundle(graph);
  };

  const handleDockerCompose = async () => {
    const graph = exportGraph();
    const content = await getDockerCompose(graph);
    setDeployLabel('docker-compose.yml');
    setDeployContent(content);
    setShowDeploy(true);
  };

  const statusColor = executionResult
    ? executionResult.status === 'success' ? '#22c55e' : '#ef4444'
    : '#475569';
  const statusLabel = executionResult ? `${executionResult.status} (${Math.round(executionResult.duration_ms ?? 0)}ms)` : '';

  return (
    <>
      <header
        className="flex items-center gap-4 px-4 h-14 flex-shrink-0"
        style={{ background: '#0f1117', borderBottom: '1px solid #2d3148' }}
      >
        {/* Logo */}
        <div className="flex items-center gap-2 mr-2">
          <span className="text-xl">🕸️</span>
          <span className="text-base font-bold" style={{ color: '#6366f1' }}>
            AI-Graph
          </span>
        </div>

        {/* Graph name */}
        <input
          className="bg-transparent border-none outline-none text-sm font-medium max-w-xs"
          style={{ color: '#e2e8f0', borderBottom: '1px dashed #2d3148', paddingBottom: 2 }}
          value={metadata.name}
          onChange={(e) => setMetadata({ name: e.target.value })}
        />

        <div className="flex-1" />

        {/* Actions */}
        <button
          onClick={onNewGraph}
          className="px-3 py-1.5 text-xs rounded-lg"
          style={{ background: '#2d3148', color: '#e2e8f0' }}
        >
          New
        </button>
        <button
          onClick={onLoad}
          className="px-3 py-1.5 text-xs rounded-lg"
          style={{ background: '#2d3148', color: '#e2e8f0' }}
        >
          Load
        </button>
        <button
          onClick={onSave}
          className="px-3 py-1.5 text-xs rounded-lg"
          style={{ background: '#2d3148', color: '#e2e8f0' }}
        >
          Save JSON
        </button>

        {/* Deploy dropdown */}
        <div className="relative">
          <button
            onClick={() => setShowDeploy(!showDeploy)}
            className="px-3 py-1.5 text-xs rounded-lg flex items-center gap-1"
            style={{ background: '#2d3148', color: '#e2e8f0' }}
          >
            🚀 Deploy ▾
          </button>
        </div>

        {/* Run */}
        <button
          onClick={handleRun}
          disabled={isExecuting}
          className="px-4 py-1.5 text-xs rounded-lg font-semibold flex items-center gap-2"
          style={{ background: isExecuting ? '#374151' : '#6366f1', color: 'white', opacity: isExecuting ? 0.7 : 1 }}
        >
          {isExecuting ? '⏳ Running…' : '▶ Run Graph'}
        </button>

        {/* Status */}
        {statusLabel && (
          <span className="text-xs font-medium" style={{ color: statusColor }}>
            {statusLabel}
          </span>
        )}
      </header>

      {/* Deploy menu */}
      {showDeploy && (
        <div
          className="fixed z-50"
          style={{ top: 56, right: 16, background: '#1a1d2e', border: '1px solid #2d3148', borderRadius: 8, minWidth: 200, boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}
        >
          <button
            className="w-full text-left px-4 py-3 text-sm hover:bg-white/5 transition-colors"
            style={{ color: '#e2e8f0' }}
            onClick={() => { setShowDeploy(false); handleDownloadBundle(); }}
          >
            📦 Download Bundle (zip)
          </button>
          <button
            className="w-full text-left px-4 py-3 text-sm hover:bg-white/5 transition-colors"
            style={{ color: '#e2e8f0' }}
            onClick={() => { setShowDeploy(false); handleDockerCompose(); }}
          >
            🐳 View Docker Compose
          </button>
          <button
            className="w-full text-left px-4 py-3 text-sm hover:bg-white/5 transition-colors border-t"
            style={{ color: '#94a3b8', borderColor: '#2d3148' }}
            onClick={() => setShowDeploy(false)}
          >
            Cancel
          </button>
        </div>
      )}

      {/* Deploy preview modal */}
      {deployContent && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.7)' }}
          onClick={() => setDeployContent('')}
        >
          <div
            className="rounded-xl overflow-hidden shadow-2xl w-full max-w-2xl mx-4"
            style={{ background: '#1a1d2e', border: '1px solid #2d3148' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3" style={{ background: '#0f1117', borderBottom: '1px solid #2d3148' }}>
              <span className="text-sm font-semibold" style={{ color: '#e2e8f0' }}>{deployLabel}</span>
              <button onClick={() => setDeployContent('')} style={{ color: '#94a3b8' }}>✕</button>
            </div>
            <pre className="p-5 overflow-auto text-xs font-mono" style={{ color: '#94a3b8', maxHeight: '60vh' }}>
              {deployContent}
            </pre>
          </div>
        </div>
      )}
    </>
  );
}
