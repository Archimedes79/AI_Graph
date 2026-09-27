import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronDown } from 'lucide-react';
import { DIM, LINE, MUTED, PANEL, TEXT } from '@/ui/theme';

/** One entry of the File menu: what it says, whether it can be chosen now -- and if not, why. */
export interface FileAction {
  label: string;
  /** A second line, smaller: what it is for. */
  hint?: string;
  /** Its key, where it has one. */
  shortcut?: string;
  /** Why it cannot be chosen now; absent, it can. */
  blocked?: string | null;
  /** Starts a group of its own. */
  divided?: boolean;
  onSelect: () => void;
}

/** What the File menu offers, in its order. The handlers are the header's; *busyWith* is why a graph cannot be replaced now. */
export function fileActions({ busyWith, isProject, onNew, onDesign, onOpen, onSave, onSaveAs, onReload, onJson }: {
  busyWith: string | null;
  isProject: boolean;
  onNew: () => void;
  onDesign: () => void;
  onOpen: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onReload: () => void;
  onJson: () => void;
}): FileAction[] {
  // Not while a run or a sweep is going: what they bring back is for the
  // graph they started on, and is dropped once another is open.
  return [
    { label: 'New', hint: 'An empty graph', blocked: busyWith, onSelect: onNew },
    // Designing a new graph lives beside New: changing this one is the bar under the canvas.
    { label: '✨ AI Graph…', hint: 'Describe a graph and let the AI build it', onSelect: onDesign },
    { label: 'Open…', hint: 'A graph file or a project folder', blocked: busyWith, onSelect: onOpen },
    { label: 'Save', shortcut: 'Ctrl+S', divided: true, onSelect: onSave },
    { label: 'Save as…', onSelect: onSaveAs },
    // Code and prompts that change on disk come in by themselves; this is
    // for the flow and the nodes' settings -- after a git pull, say.
    ...(isProject ? [{
      label: 'Reload from disk', hint: 'flow.json or a node\'s settings changed outside the editor', blocked: busyWith, onSelect: onReload,
    }] : []),
    { label: 'Copy / paste as JSON…', divided: true, onSelect: onJson },
  ];
}

/**
 * The file actions, in one menu under the header's "File": they are used now
 * and then, and as buttons they took a third of the bar.
 *
 * Drawn fixed under its button rather than inside the header, which scrolls
 * sideways in a window too narrow for it and would cut a menu off. Opened, the
 * first entry has the focus: arrows move it, Enter chooses, Escape closes --
 * and Escape goes no further, so the panel beside the canvas stays open.
 */
export default function FileMenu({ actions, where }: { actions: FileAction[]; where: string }) {
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const close = () => setAt(null);

  useEffect(() => {
    if (!at) return undefined;
    menu.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not([disabled])')?.focus();
    const away = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!menu.current?.contains(target) && !button.current?.contains(target)) close();
    };
    document.addEventListener('mousedown', away);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', away);
      window.removeEventListener('resize', close);
    };
  }, [at]);

  const toggle = () => {
    if (at || !button.current) {
      close();
      return;
    }
    const bounds = button.current.getBoundingClientRect();
    setAt({ left: Math.max(8, Math.min(bounds.left, window.innerWidth - 272)), top: bounds.bottom + 4 });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
      button.current?.focus();
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const items = [...(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])') ?? [])];
    const here = items.indexOf(document.activeElement as HTMLButtonElement);
    items[(here + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={!!at}
        className="h-8 shrink-0 flex items-center gap-1 rounded-md px-2.5 text-sm font-medium hover-raise"
        style={{ color: TEXT }}
        title="New, Open, Save, Save as…, and the graph as JSON"
      >
        File
        <ChevronDown size={14} strokeWidth={2} aria-hidden="true" style={{ color: MUTED }} />
      </button>
      {at && (
        <div
          ref={menu}
          role="menu"
          aria-label="File"
          className="nokey fixed z-50 w-64 rounded-lg py-1 shadow-2xl"
          style={{ ...PANEL, left: at.left, top: at.top }}
          onKeyDown={onKeyDown}
        >
          <div className="truncate px-3 pt-1.5 pb-2 text-xs" style={{ color: DIM, borderBottom: `1px solid ${LINE}` }} title={where}>
            {where}
          </div>
          {actions.map((action) => (
            <div key={action.label} style={action.divided ? { borderTop: `1px solid ${LINE}`, marginTop: 4, paddingTop: 4 } : undefined}>
              <button
                type="button"
                role="menuitem"
                disabled={!!action.blocked}
                title={action.blocked ?? undefined}
                onClick={() => {
                  close();
                  action.onSelect();
                }}
                className="flex w-full items-start gap-3 px-3 py-1.5 text-left text-sm hover-raise"
                style={{ color: TEXT, opacity: action.blocked ? 0.4 : 1 }}
              >
                <span className="flex-1 min-w-0">
                  <span className="block">{action.label}</span>
                  {action.hint && <span className="block truncate text-xs" style={{ color: DIM }}>{action.hint}</span>}
                </span>
                {action.shortcut && <span className="shrink-0 text-xs" style={{ color: DIM }}>{action.shortcut}</span>}
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
