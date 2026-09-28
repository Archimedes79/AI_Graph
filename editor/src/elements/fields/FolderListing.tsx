import React from 'react';
import { errorText } from '@/api/errorText';
import { DANGER_TEXT, DIMMER, MUTED, NEUTRAL_BUTTON, SUNKEN, TEXT } from '@/ui/theme';

/** How many paths of a listing are shown; the rest are counted. */
const SHOWN = 40;

interface Props {
  recursive: boolean;
  onRecursive: (recursive: boolean) => void;
  /** No folder is chosen yet: there is nothing to list. */
  noFolder: boolean;
  /** The listing, made the way a run makes it. */
  list: () => Promise<string[]>;
  /** What the listing is of -- folder, file types, subfolders -- so a listing made before a change is not shown after it. */
  of: string;
}

/**
 * What a folder listing adds to the folder and its file types, for an input
 * node and a folder picker on a page alike: whether it looks into subfolders,
 * that it hands on every file it lists, and -- when asked -- that list, made
 * the way a run makes it. Keeping only some of the files is a code node after
 * it, and the panel says so.
 */
export default function FolderListing({ recursive, onRecursive, noFolder, list, of }: Props) {
  const [files, setFiles] = React.useState<string[] | null>(null);
  const [failure, setFailure] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  // What the listing is of now, for one that comes back after a change: it
  // is dropped. Shown, "Look into subfolders too" ticked during a slow
  // listing showed the list from before the tick.
  const now = React.useRef(of);
  React.useEffect(() => { now.current = of; setFiles(null); setFailure(''); }, [of]);

  const show = async () => {
    const asked = of;
    setBusy(true);
    setFailure('');
    try {
      const listed = await list();
      if (now.current === asked) setFiles(listed);
    } catch (error) {
      if (now.current !== asked) return;
      setFiles(null);
      setFailure(errorText(error, 'The folder could not be listed.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-sm" style={{ color: MUTED }}>
        <input type="checkbox" checked={recursive} onChange={(e) => onRecursive(e.target.checked)} />
        Look into subfolders too
      </label>
      <p className="text-xs" style={{ color: DIMMER }}>
        Hands on every file it lists, as a list of paths. To use only some of them, wire a code node after it that keeps those.
      </p>
      <button className="text-xs px-2 py-1 rounded" style={{ ...NEUTRAL_BUTTON, opacity: busy || noFolder ? 0.5 : 1 }}
        disabled={busy || noFolder} onClick={show}
        title={noFolder ? 'Choose a folder first' : 'List the folder the way a run lists it: its file types, and its subfolders when it looks into them'}>
        {busy ? 'Listing…' : files ? 'List them again' : 'Show the files it lists'}
      </button>
      {failure && <p className="text-xs" style={{ color: DANGER_TEXT }}>{failure}</p>}
      {files && (
        <div className="text-xs rounded px-2 py-1.5" style={{ background: SUNKEN }}>
          <p style={{ color: MUTED }}>{files.length === 1 ? '1 file' : `${files.length} files`}</p>
          {files.length > 0 && (
            <pre className="whitespace-pre-wrap overflow-auto" style={{ color: TEXT, maxHeight: 180 }}>
              {files.slice(0, SHOWN).join('\n')}
              {files.length > SHOWN ? `\n… and ${files.length - SHOWN} more` : ''}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
