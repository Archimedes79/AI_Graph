import { useState } from 'react';
import { useGraphStore } from '@/store/graphStore';
import { call } from '@/api/client';
import { errorText } from '@/api/errorText';
import { MUTED, NEUTRAL_BUTTON } from '@/ui/theme';

/**
 * "↗ Open in my editor": hand a node's file -- or a block's, one folder below
 * its page's -- to the person's own editor.
 *
 * The project is saved first, so the file holds what the dialog shows. What is
 * saved there comes back by itself: the editor watches the project folder (see
 * App.tsx). The node dialog and the block editor each wrote this out, button,
 * steps and sentences alike.
 *
 * *before* runs once the click is taken and before the save, for a dialog
 * whose draft must reach the store first; what is saved is read after it.
 * Whether the node or block has a body to open is the caller's to ask.
 */
export default function OpenInMyEditor({ nodeId, widgetId, before }: {
  nodeId: string;
  widgetId?: string;
  before?: () => void;
}) {
  const isProject = useGraphStore((s) => s.isProject);
  const [status, setStatus] = useState('');
  if (!isProject) return null;

  const open = async () => {
    const graphPath = useGraphStore.getState().currentFilePath;
    if (!graphPath) return;
    try {
      setStatus('Saving, then opening…');
      before?.();
      await useGraphStore.getState().save();
      const opened = await call('openExternal', { graph_path: graphPath, node_id: nodeId, widget_id: widgetId });
      setStatus(`Opened in ${opened.with}: ${opened.path}. What you save there appears here by itself.`);
    } catch (error) {
      setStatus(errorText(error, 'Could not open the file.'));
    }
  };

  return (
    <div>
      <button
        onClick={open}
        className="text-xs px-3 py-1.5 rounded-lg"
        style={NEUTRAL_BUTTON}
        title={`Saves the project, then opens this ${widgetId ? 'block' : 'node'}'s file — in VS Code when it is installed`}
      >
        ↗ Open in my editor
      </button>
      {status && <p className="text-xs mt-1" style={{ color: MUTED }}>{status}</p>}
    </div>
  );
}
