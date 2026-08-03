import React, { useRef, useState } from 'react';
import { deleteAttachment, uploadAttachment } from '../../utils/api';

interface ContextFileAttachmentProps {
  label: string;
  /** Server-side path of the stored attachment, or '' if none attached. */
  path: string;
  onChange: (path: string) => void;
}

/** Strips the uuid-prefix save_attachment() adds so the UI shows the original filename. */
function displayName(path: string): string {
  const base = path.replace(/^.*[\\/]/, '');
  return base.replace(/^[0-9a-f]{32}_/, '');
}

export default function ContextFileAttachment({ label, path, onChange }: ContextFileAttachmentProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const handleFile = async (file: File | null | undefined) => {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const result = await uploadAttachment(file);
      onChange(result.path);
    } catch (e: any) {
      setError(e?.response?.data?.detail ?? e?.message ?? 'Upload failed');
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async () => {
    setBusy(true);
    try {
      await deleteAttachment(path);
    } catch {
      // best-effort -- clear the reference either way
    } finally {
      onChange('');
      setBusy(false);
    }
  };

  return (
    <div>
      <label className="block text-xs font-medium mb-1" style={{ color: '#94a3b8' }}>{label}</label>
      {path ? (
        <div
          className="flex items-center justify-between rounded-lg px-3 py-2 text-sm"
          style={{ background: '#0f1117', border: '1px solid #2d3148', color: '#e2e8f0' }}
        >
          <span className="truncate">📎 {displayName(path)}</span>
          <button onClick={handleRemove} disabled={busy} className="text-xs px-2" style={{ color: '#f87171' }}>
            ✕ Remove
          </button>
        </div>
      ) : (
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); handleFile(e.dataTransfer.files?.[0]); }}
          onClick={() => inputRef.current?.click()}
          className="rounded-lg px-3 py-2 text-sm text-center cursor-pointer"
          style={{ background: '#0f1117', border: '1px dashed #2d3148', color: '#64748b' }}
        >
          {busy ? 'Uploading…' : '📎 Drop a file here, or click to attach'}
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            onChange={(e) => handleFile(e.target.files?.[0])}
          />
        </div>
      )}
      {error && <p className="text-xs mt-1" style={{ color: '#f87171' }}>{error}</p>}
    </div>
  );
}
