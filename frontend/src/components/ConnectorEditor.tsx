import React, { useEffect, useState } from 'react';
import { useGraphStore } from '../store/graphStore';
import { detectFileFormat } from '../utils/api';
import Modal from './Modal';
import { errorText } from '../utils/errorText';
import { ACCENT, DANGER_SOFT, DIMMER, FIELD, MUTED, NEUTRAL_BUTTON } from '../ui/theme';

interface ConnectorEditorProps {
  nodeId: string;
  portId: string;
  onClose: () => void;
}

export default function ConnectorEditor({ nodeId, portId, onClose }: ConnectorEditorProps) {
  const graphNode = useGraphStore((state) => state.rfNodes.find((node) => node.id === nodeId)?.data.graphNode);
  const updateNode = useGraphStore((state) => state.updateNode);
  const port = graphNode?.inputs.find((item) => item.id === portId) ?? graphNode?.outputs.find((item) => item.id === portId);
  const [format, setFormat] = useState(port?.format ?? '');
  const [debugDirectory, setDebugDirectory] = useState(port?.debug_directory ?? '');
  const [samplePath, setSamplePath] = useState(graphNode?.config.value ?? '');
  const [detecting, setDetecting] = useState(false);
  const [detectError, setDetectError] = useState('');

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
      setDetectError(errorText(e, 'Detection failed'));
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
    onClose();
  };

  return (
    <Modal
      title={
        <>
          Connector: {port.name}
          <span className="ml-2 font-normal" style={{ color: MUTED }}>
            {port.data_type} {port.multi ? 'batch' : 'single'} value
          </span>
        </>
      }
      onClose={onClose}
      maxWidth="max-w-md"
      // Opens on top of the node editor, and a stray backdrop click there
      // would drop half-entered connector settings.
      zIndex={60}
      dismissOnBackdrop={false}
      footer={
        <>
          <button onClick={onClose} className="px-3 py-2 text-sm rounded-lg" style={NEUTRAL_BUTTON}>Cancel</button>
          <button onClick={save} className="px-3 py-2 text-sm rounded-lg font-semibold" style={{ background: ACCENT, color: '#fff' }}>Save connector</button>
        </>
      }
    >
      <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: MUTED }}>File format</label>
            <input className="w-full rounded-lg px-3 py-2 text-sm" style={FIELD} value={format} onChange={(event) => setFormat(event.target.value)} placeholder="application/json or text/csv" />
            <p className="text-xs mt-1" style={{ color: DIMMER }}>Use a MIME type or format name. JSON and CSV are parsed at block inputs and serialized at debug outputs.</p>
            {port.data_type === 'file_path' && (
              <div className="mt-2">
                {graphNode.node_type === 'input' && (
                  <input
                    className="w-full rounded-lg px-3 py-2 text-sm font-mono mb-2"
                    style={FIELD}
                    value={samplePath}
                    onChange={(event) => setSamplePath(event.target.value)}
                    placeholder="Sample file path within the directory"
                  />
                )}
                <button
                  onClick={() => detectFormat(
                    graphNode.node_type === 'input'
                      ? samplePath
                      : graphNode.config.value ?? ''
                  )}
                  disabled={detecting}
                  className="px-3 py-1.5 text-xs rounded-lg font-semibold"
                  style={{ ...NEUTRAL_BUTTON, opacity: detecting ? 0.6 : 1 }}
                >
                  {detecting ? 'Detecting…' : 'Detect format'}
                </button>
                {detectError && <p className="text-xs mt-1" style={{ color: DANGER_SOFT }}>{detectError}</p>}
              </div>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: MUTED }}>Runtime debug directory</label>
            <input className="w-full rounded-lg px-3 py-2 text-sm font-mono" style={FIELD} value={debugDirectory} onChange={(event) => setDebugDirectory(event.target.value)} placeholder="E:\\test\\debug" />
            <p className="text-xs mt-1" style={{ color: DIMMER }}>Each value crossing this connector is written here during a run for inspection.</p>
          </div>
      </div>
    </Modal>
  );
}