import { useGraphStore } from '@/store/graphStore';
import { LINE, MUTED, SUNKEN, SURFACE, TEXT } from '@/ui/theme';

/**
 * The floating windows an output node set to "window" opens after a run.
 *
 * Mounted once per page -- the editor's App, a delivered tool's RuntimeApp --
 * because they are the store's, not any one run button's. They used to be
 * drawn by every RequirementsDialog, and the Preview tab has two of those (the
 * toolbar's and its own), so each window was drawn twice in the same spot:
 * resizing the top one uncovered the other.
 */
export default function OutputWindows() {
  const windows = useGraphStore((s) => s.textOutputWindows);
  const close = useGraphStore((s) => s.closeTextOutputWindow);
  if (windows.length === 0) return null;

  return (
    <div className="fixed z-40 flex flex-col-reverse gap-3" style={{ bottom: 16, right: 352 }}>
      {windows.map((win, i) => (
        <div
          key={win.nodeId}
          className="rounded-xl shadow-2xl flex flex-col"
          style={{
            background: SURFACE,
            border: `1px solid ${LINE}`,
            width: 480,
            maxWidth: '90vw',
            height: 320,
            maxHeight: '60vh',
            resize: 'both',
            overflow: 'hidden',
            marginRight: i * 12,
          }}
        >
          <div
            className="flex items-center justify-between px-4 py-2 flex-shrink-0"
            style={{ background: SUNKEN, borderBottom: `1px solid ${LINE}` }}
          >
            <span className="text-sm font-semibold flex items-center gap-2" style={{ color: TEXT }}>
              🪟 {win.label}
            </span>
            <button
              onClick={() => close(win.nodeId)}
              style={{ color: MUTED }}
              className="hover:text-white text-sm"
              aria-label={`Close output window ${win.label}`}
            >
              ✕
            </button>
          </div>
          <pre className="flex-1 overflow-auto px-4 py-3 text-sm whitespace-pre-wrap" style={{ color: TEXT }}>
            {win.content}
          </pre>
        </div>
      ))}
    </div>
  );
}
