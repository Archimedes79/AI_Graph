import React, { useEffect, useState } from 'react';
import { useGraphStore } from '../store/graphStore';
import type { RFEdgeData } from '../store/graphStore';
import { detectFileFormat } from '../utils/api';

interface ConnectorEditorProps {
  nodeId: string;
  portId: string;
  onClose: () => void;
}

export default function ConnectorEditor({ nodeId, portId, onClose }: ConnectorEditorProps) {
  const graphNode = useGraphStore((state) => state.rfNodes.find((node) => node.id === nodeId)?.data.graphNode);
  const updateNode = useGraphStore((state) => state.updateNode);
  const rfEdges = useGraphStore((state) => state.rfEdges);
  const setEdgeFeedback = useGraphStore((state) => state.setEdgeFeedback);
  const port = graphNode?.inputs.find((item) => item.id === portId) ?? graphNode?.outputs.find((item) => item.id === portId);
  const attachedEdges = rfEdges.filter((edge) =>
    port?.kind === 'input'
      ? edge.target === nodeId && edge.targetHandle === portId
      : edge.source === nodeId && edge.sourceHandle === portId
  );
  const [format, setFormat] = useState(port?.format ?? '');
  const [debugDirectory, setDebugDirectory] = useState(port?.debug_directory ?? '');
  const [samplePath, setSamplePath] = useState((graphNode?.config.example_path || graphNode?.config.value) ?? '');
  const [deferred, setDeferred] = useState(false);
  const [initialValue, setInitialValue] = useState('');
  const [detecting, setDetecting] = useState(false);
  const [detectError, setDetectError] = useState('');

  const attachedSignature = attachedEdges.map((edge) => edge.id).join('|');
  useEffect(() => {
    const first = attachedEdges[0]?.data as RFEdgeData | undefined;
    setDeferred(attachedEdges.length > 0 && attachedEdges.every((edge) => (edge.data as RFEdgeData | undefined)?.deferred === true));
    setInitialValue(first?.initial_value === undefined ? '' : String(first.initial_value));
    // Re-seed only when the set of attached edges changes, not on every render.
  }, [attachedSignature]);

  useEffect(() => {
    setFormat(port?.format ?? '');
    setDebugDirectory(port?.debug_directory ?? '');
  }, [port?.format, port?.debug_directory]);

  useEffect(() => {
    setSamplePath(graphNode?.config.value ?? '');
  }, [graphNode?.config.value]);

  if (!graphNode || !port) return null;

  const detectFormat = async (path: string) => {
    if (!path) {
      setDetectError('Enter a sample file path first.');
      return;
    }
    setDetecting(true);
    setDetectError('');
    try {
      const result = await detectFileFormat(path);
      setFormat(result.format);
    } catch (e: any) {
      setDetectError(e?.response?.data?.detail ?? e?.message ?? 'Detection failed');
    } finally {
      setDetecting(false);
    }
  };

  const save = () => {
    const updatePort = (candidate: typeof port) => candidate.id === portId
      ? { ...candidate, format: format || undefined, debug_directory: debugDirectory || undefined }
      : candidate;
    updateNode(nodeId, {
      inputs: graphNode.inputs.map(updatePort),
      outputs: graphNode.outputs.map(updatePort),
    });
    for (const edge of attachedEdges) {
      setEdgeFeedback(edge.id, {
        deferred: deferred || undefined,
        initial_value: deferred && initialValue !== '' ? initialValue : undefined,
      });
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.7)' }}>
      <div className="w-full max-w-md mx-4 rounded-xl shadow-2xl overflow-hidden" style={{ background: '#1a1d2e', border: '1px solid #2d3148' }}>
        <div className="px-5 py-4" style={{ background: '#0f1117', borderBottom: '1px solid #2d3148' }}>
          <h2 className="text-sm font-semibold" style={{ color: '#e2e8f0' }}>Connector: {port.name}</h2>
          <p className="text-xs mt-1" style={{ color: '#94a3b8' }}>{port.data_type} {port.multi ? 'batch' : 'single'} value</p>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: '#94a3b8' }}>File format</label>
            <input className="w-full rounded-lg px-3 py-2 text-sm" style={{ background: '#0f1117', color: '#e2e8f0', border: '1px solid #2d3148' }} value={format} onChange={(event) => setFormat(event.target.value)} placeholder="application/json or text/csv" />
            <p className="text-xs mt-1" style={{ color: '#475569' }}>Use a MIME type or format name. JSON and CSV are parsed at block inputs and serialized at debug outputs.</p>
            {port.data_type === 'file_path' && (
              <div className="mt-2">
                {(graphNode.node_type === 'directory_input' || graphNode.node_type === 'input') && (
                  <input
                    className="w-full rounded-lg px-3 py-2 text-sm font-mono mb-2"
                    style={{ background: '#0f1117', color: '#e2e8f0', border: '1px solid #2d3148' }}
                    value={samplePath}
                    onChange={(event) => setSamplePath(event.target.value)}
                    placeholder="Sample file path within the directory"
                  />
                )}
                <button
                  onClick={() => detectFormat(
                    (graphNode.node_type === 'directory_input' || graphNode.node_type === 'input')
                      ? samplePath
                      : (graphNode.config.example_path || graphNode.config.value) ?? ''
                  )}
                  disabled={detecting}
                  className="px-3 py-1.5 text-xs rounded-lg font-semibold"
                  style={{ background: '#2d3148', color: '#e2e8f0', opacity: detecting ? 0.6 : 1 }}
                >
                  {detecting ? 'Detecting…' : 'Detect format'}
                </button>
                {detectError && <p className="text-xs mt-1" style={{ color: '#f87171' }}>{detectError}</p>}
              </div>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: '#94a3b8' }}>Runtime debug directory</label>
            <input className="w-full rounded-lg px-3 py-2 text-sm font-mono" style={{ background: '#0f1117', color: '#e2e8f0', border: '1px solid #2d3148' }} value={debugDirectory} onChange={(event) => setDebugDirectory(event.target.value)} placeholder="E:\\test\\debug" />
            <p className="text-xs mt-1" style={{ color: '#475569' }}>Each value crossing this connector is written here during a run for inspection.</p>
          </div>
          <div>
            <label className="flex items-center gap-2 text-xs font-medium" style={{ color: attachedEdges.length ? '#94a3b8' : '#475569' }}>
              <input
                type="checkbox"
                checked={deferred}
                disabled={attachedEdges.length === 0}
                onChange={(event) => setDeferred(event.target.checked)}
              />
              t+1 (feedback) edge
            </label>
            <p className="text-xs mt-1" style={{ color: '#475569' }}>
              {attachedEdges.length === 0
                ? 'Connect this port to a node to mark the connection as feedback.'
                : `Applies to ${attachedEdges.length} connection${attachedEdges.length === 1 ? '' : 's'} on this port. A t+1 edge carries the previous round's value and is excluded from cycle detection, so gui → ai → gui loops can run.`}
            </p>
            {deferred && (
              <input
                className="w-full rounded-lg px-3 py-2 text-sm mt-2"
                style={{ background: '#0f1117', color: '#e2e8f0', border: '1px solid #2d3148' }}
                value={initialValue}
                onChange={(event) => setInitialValue(event.target.value)}
                placeholder="Initial value for the first round (optional)"
              />
            )}
          </div>
        </div>
        <div className="flex justify-end gap-3 px-5 py-4" style={{ background: '#0f1117', borderTop: '1px solid #2d3148' }}>
          <button onClick={onClose} className="px-3 py-2 text-sm rounded-lg" style={{ background: '#2d3148', color: '#e2e8f0' }}>Cancel</button>
          <button onClick={save} className="px-3 py-2 text-sm rounded-lg font-semibold" style={{ background: '#6366f1', color: '#fff' }}>Save connector</button>
        </div>
      </div>
    </div>
  );
}