import React, { useCallback, useEffect, useState } from 'react';
import Modal from './Modal';
import { browseDirectory } from '../utils/api';
import { errorText } from '../utils/errorText';
import {
  ACCENT_TEXT, DANGER_TEXT, DIMMER, FIELD, LINE, MUTED, NEUTRAL_BUTTON, PRIMARY_BUTTON, SUNKEN, TEXT,
} from '../ui/theme';

export interface BrowseEntry {
  name: string;
  path: string;
  is_dir: boolean;
}

interface FileBrowserDialogProps {
  /**
   * `file` picks an existing file, `directory` the folder currently open, and
   * `save` picks a folder plus a name to write into it.
   */
  mode: 'file' | 'directory' | 'save';
  /** `save` only: the filename to start from. */
  defaultName?: string;
  /** Where to open. A file path opens its containing folder. */
  initialPath?: string;
  /** Comma-separated extension filter, e.g. ".md, .txt" — files only. */
  extensions?: string;
  onPick: (path: string) => void;
  onClose: () => void;
}

/**
 * A file/directory picker that browses the machine the GRAPH runs on.
 *
 * The obvious implementation — `<input type="file">` — cannot work here: a
 * browser deliberately never reveals a chosen file's location, only its name,
 * while the engine resolves real absolute paths server-side. The native dialog
 * therefore produced a name that failed later with a file-not-found from
 * whatever the working directory happened to be. This walks the server's
 * filesystem over `/api/files/browse` instead, so what it returns is a path the
 * engine can actually open.
 */
export default function FileBrowserDialog({
  mode, initialPath, extensions, defaultName, onPick, onClose,
}: FileBrowserDialogProps) {
  const [path, setPath] = useState('');
  const [parent, setParent] = useState<string | null>(null);
  const [entries, setEntries] = useState<BrowseEntry[]>([]);
  const [roots, setRoots] = useState<string[]>([]);
  const [selected, setSelected] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [fileName, setFileName] = useState(defaultName ?? '');

  const load = useCallback(async (target: string) => {
    setLoading(true);
    setError('');
    try {
      // The filter applies to files only; in directory mode it would just hide
      // the folders the user is trying to navigate through.
      const data = await browseDirectory(target, mode === 'file' ? extensions : '');
      setPath(data.path);
      setParent(data.parent);
      setEntries(data.entries);
      setRoots(data.roots);
      setSelected('');
    } catch (e) {
      setError(errorText(e, 'Could not read that directory.'));
    } finally {
      setLoading(false);
    }
  }, [extensions, mode]);

  useEffect(() => { load(initialPath || ''); }, [load, initialPath]);

  const activate = (entry: BrowseEntry) => {
    if (entry.is_dir) load(entry.path);
    else if (mode === 'file') onPick(entry.path);
  };

  /** Join with the separator the server itself used, rather than guessing. */
  const join = (dir: string, name: string) => {
    const sep = dir.includes('\\') && !dir.includes('/') ? '\\' : '/';
    return dir.endsWith(sep) ? `${dir}${name}` : `${dir}${sep}${name}`;
  };

  const confirmLabel = mode === 'directory' ? 'Use this folder' : mode === 'save' ? 'Save here' : 'Select';
  const canConfirm =
    mode === 'directory' ? !!path : mode === 'save' ? !!path && !!fileName.trim() : !!selected;

  const confirm = () => {
    if (mode === 'directory') return onPick(path);
    if (mode === 'save') return onPick(join(path, fileName.trim()));
    return onPick(selected);
  };

  return (
    <Modal
      title={mode === 'directory' ? 'Choose a folder' : mode === 'save' ? 'Choose where to save' : 'Choose a file'}
      onClose={onClose}
      maxWidth="max-w-2xl"
      footer={
        <>
          <button className="px-3 py-1.5 rounded-lg text-sm" style={NEUTRAL_BUTTON} onClick={onClose}>
            Cancel
          </button>
          <button
            className="px-3 py-1.5 rounded-lg text-sm"
            style={{ ...PRIMARY_BUTTON, opacity: canConfirm ? 1 : 0.5 }}
            disabled={!canConfirm}
            onClick={confirm}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <button
            className="px-2 py-1.5 rounded-lg text-sm flex-shrink-0"
            style={{ ...NEUTRAL_BUTTON, opacity: parent ? 1 : 0.4 }}
            disabled={!parent}
            onClick={() => parent && load(parent)}
            title="Up one level"
            aria-label="Up one level"
          >
            ↑
          </button>
          <input
            className="flex-1 min-w-0 rounded-lg px-2 py-1.5 text-sm font-mono"
            style={FIELD}
            value={path}
            onChange={(e) => setPath(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') load(path); }}
            aria-label="Current path"
          />
          <button
            className="px-3 py-1.5 rounded-lg text-sm flex-shrink-0"
            style={NEUTRAL_BUTTON}
            onClick={() => load(path)}
          >
            Go
          </button>
        </div>

        {roots.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {roots.map((root) => (
              <button
                key={root}
                className="text-xs px-2 py-1 rounded font-mono"
                style={{ background: LINE, color: ACCENT_TEXT }}
                onClick={() => load(root)}
              >
                {root}
              </button>
            ))}
          </div>
        )}

        <div
          className="rounded-lg overflow-y-auto"
          style={{ background: SUNKEN, border: `1px solid ${LINE}`, height: 320 }}
        >
          {loading && <div className="p-3 text-sm" style={{ color: MUTED }}>Loading…</div>}
          {!loading && error && <div className="p-3 text-sm" style={{ color: DANGER_TEXT }}>{error}</div>}
          {!loading && !error && entries.length === 0 && (
            <div className="p-3 text-sm" style={{ color: DIMMER }}>
              {mode === 'file' && extensions ? `No folders, and no files matching ${extensions}.` : 'This folder is empty.'}
            </div>
          )}
          {!loading && !error && entries.map((entry) => {
            const isSelected = !entry.is_dir && selected === entry.path;
            return (
              <button
                key={entry.path}
                className="w-full text-left px-3 py-1.5 text-sm font-mono flex items-center gap-2"
                style={{ background: isSelected ? LINE : 'transparent', color: entry.is_dir ? ACCENT_TEXT : TEXT }}
                onClick={() => {
                  if (entry.is_dir) return load(entry.path);
                  setSelected(entry.path);
                  if (mode === 'save') setFileName(entry.name);
                }}
                onDoubleClick={() => activate(entry)}
                title={entry.path}
              >
                <span aria-hidden="true">{entry.is_dir ? '📁' : '📄'}</span>
                <span className="truncate">{entry.name}</span>
              </button>
            );
          })}
        </div>

        {mode === 'save' && (
          <div className="flex items-center gap-2">
            <label className="text-xs flex-shrink-0" style={{ color: MUTED }} htmlFor="save-file-name">
              File name
            </label>
            <input
              id="save-file-name"
              className="flex-1 min-w-0 rounded-lg px-2 py-1.5 text-sm font-mono"
              style={FIELD}
              value={fileName}
              onChange={(e) => setFileName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && canConfirm) confirm(); }}
              placeholder="my_graph.json"
            />
          </div>
        )}

        <p className="text-xs" style={{ color: DIMMER }}>
          {mode === 'directory'
            ? 'Navigate into the folder you want, then confirm. Paths are on the machine running the graph.'
            : mode === 'save'
              ? 'Navigate to the folder, then name the file. Clicking an existing file reuses its name. Paths are on the machine running the graph.'
              : 'Click a file to select it, double-click to select and confirm. Paths are on the machine running the graph.'}
        </p>
      </div>
    </Modal>
  );
}
