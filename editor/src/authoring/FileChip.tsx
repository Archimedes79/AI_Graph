import { useState } from 'react';
import { useGraphStore } from '@/store/graphStore';
import { call } from '@/api/client';
import { errorText } from '@/api/errorText';
import { DIMMER, MUTED, NEUTRAL_BUTTON } from '@/ui/theme';

/**
 * One of a node's files, as a chip: `input.js`, `code.js`, `history.md`. A
 * click opens it in the person's own editor -- the project is saved first, so
 * the file holds what the panel shows, and what is saved there comes back by
 * itself (the editor watches the project folder). Shown whether or not the
 * node holds anything there yet: the folder has every file from the start,
 * a stub until ✨ writes it (*written* false says so).
 *
 * In a graph not saved as a project there is no file to open: the chip is
 * greyed and says when there will be.
 */
export default function FileChip({ nodeId, file, written, before }: {
  nodeId: string;
  file: string;
  /** The node holds something there; otherwise the file is its stub. */
  written: boolean;
  /** Runs once the click is taken and before the save: what the dialog still holds is written into the graph first. */
  before?: () => void;
}) {
  const isProject = useGraphStore((s) => s.isProject);
  const [status, setStatus] = useState('');

  const open = async () => {
    const graphPath = useGraphStore.getState().currentFilePath;
    if (!graphPath) return;
    try {
      setStatus('Saving, then opening…');
      before?.();
      await useGraphStore.getState().save();
      const opened = await call('openExternal', { graph_path: graphPath, node_id: nodeId, file });
      setStatus(`Opened in ${opened.with}.`);
    } catch (error) {
      setStatus(errorText(error, `Could not open ${file}.`));
    }
  };

  const title = !isProject ? 'Written when the graph is saved as a project.'
    : `Open ${file} in your own editor (the project is saved first)${written ? '' : ' -- not written yet: it holds its stub'}`;
  return (
    <span className="inline-flex items-center gap-1.5">
      <button
        type="button"
        onClick={open}
        disabled={!isProject}
        className="text-xs px-1.5 py-0.5 rounded font-mono"
        style={{ ...NEUTRAL_BUTTON, opacity: isProject ? 1 : 0.5, cursor: isProject ? 'pointer' : 'default' }}
        title={title}
        aria-label={`Open ${file}`}
      >
        {file} ↗
      </button>
      {!written && <span className="text-xs" style={{ color: DIMMER }}>{isProject ? 'not written yet' : 'written when the graph is saved as a project'}</span>}
      {status && <span className="text-xs" style={{ color: MUTED }}>{status}</span>}
    </span>
  );
}
