import { useEffect, useState } from 'react';
import type { Requirement } from '@/api/client';
import Modal from '@/ui/Modal';
import FileBrowserDialog from './FileBrowserDialog';
import { DIMMER, FIELD, MUTED, NEUTRAL_BUTTON, PRIMARY_BUTTON } from '@/ui/theme';

interface RequirementsDialogProps {
  requirements: Requirement[] | null;
  onSubmit: (values: Record<string, string>) => void;
  onCancel: () => void;
}

const KIND_ICON: Record<string, string> = { text: '📝', file: '📄', directory: '📁' };

/**
 * The "before running" window: the values a graph asks for before it can run.
 * The windows a run opens afterwards are `OutputWindows`, mounted once per page.
 */
export default function RequirementsDialog({ requirements, onSubmit, onCancel }: RequirementsDialogProps) {
  const [values, setValues] = useState<Record<string, string>>({});
  /** Key of the requirement whose picker is open, or '' for none. */
  const [browsing, setBrowsing] = useState('');

  // Answers are kept by each question's own key, the one the engine writes
  // them back by (`applyRuntimeValues`).
  useEffect(() => {
    if (requirements) {
      setValues(Object.fromEntries(requirements.map((r) => [r.key, r.current || ''])));
    }
  }, [requirements]);

  if (!requirements) return null;

  // Only input-direction requirements are mandatory; output paths are optional.
  const missing = requirements
    .filter((r) => r.direction === 'input' && (values[r.key] ?? '').trim().length === 0)
    .map((r) => r.label);
  const canSubmit = missing.length === 0;

  // Which picker the open Browse… belongs to: a directory requirement picks a
  // folder, a file requirement picks a file.
  const browsingKind = requirements.find((r) => r.key === browsing)?.kind ?? 'file';

  return (
    <Modal
      title="📥 Before running…"
      onClose={onCancel}
      // Typed paths; a backdrop click must not discard them. Escape is the
      // deliberate way out and matches Cancel.
      dismissOnBackdrop={false}
      footer={
        <>
          {/* A greyed-out Run button with no explanation just looks broken. */}
          {missing.length > 0 && (
            <span className="text-xs mr-auto" style={{ color: MUTED }}>
              Still needed: {missing.join(', ')}
            </span>
          )}
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm rounded-lg"
            style={NEUTRAL_BUTTON}
          >
            Cancel
          </button>
          <button
            onClick={() => onSubmit(values)}
            disabled={!canSubmit}
            className="px-4 py-2 text-sm rounded-lg font-semibold"
            style={{ ...PRIMARY_BUTTON, opacity: canSubmit ? 1 : 0.5 }}
          >
            ▶ Run Graph
          </button>
        </>
      }
    >
      <div className="px-6 pt-4 pb-1">
        <p className="text-xs" style={{ color: MUTED }}>
          This graph needs a few values before it can run.
        </p>
      </div>

      <div
        className="px-6 py-5 space-y-4"
        // Enter in any field runs, as in every other one-purpose dialog.
        onKeyDown={(e) => {
          if (e.key === 'Enter' && canSubmit) onSubmit(values);
        }}
      >
        {requirements.map((req, index) => (
          <div key={req.key}>
            <label className="block text-xs font-medium mb-1" style={{ color: MUTED }}>
              {KIND_ICON[req.kind] ?? '📄'}{' '}
              {req.kind === 'text'
                ? `Text for "${req.label}"`
                : `${req.direction === 'input' ? 'Read' : 'Write'} ${req.kind} for "${req.label}"`}
              {req.direction === 'output' && (
                <span className="ml-1 text-xs" style={{ color: DIMMER }}>(optional)</span>
              )}
            </label>
            <div className="flex items-center gap-2">
              <input
                className={`flex-1 min-w-0 rounded-lg px-3 py-2 text-sm ${req.kind === 'text' ? '' : 'font-mono'}`}
                style={FIELD}
                value={values[req.key] ?? ''}
                onChange={(e) => setValues((prev) => ({ ...prev, [req.key]: e.target.value }))}
                placeholder={
                  req.kind === 'text' ? 'Enter text…' : req.kind === 'directory' ? '/path/to/directory' : '/path/to/file'
                }
                autoFocus={index === 0}
              />
              {/* Typing an absolute path from memory was the only way to
                  answer this dialog; a path field should offer a picker. */}
              {req.kind !== 'text' && (
                <button
                  type="button"
                  className="text-xs px-3 py-2 rounded-lg flex-shrink-0"
                  style={NEUTRAL_BUTTON}
                  onClick={() => setBrowsing(req.key)}
                >
                  Browse…
                </button>
              )}
            </div>
          </div>
        ))}
        {browsing && (
          <FileBrowserDialog
            mode={browsingKind === 'directory' ? 'directory' : 'file'}
            initialPath={values[browsing] ?? ''}
            onPick={(picked) => {
              setValues((prev) => ({ ...prev, [browsing]: picked }));
              setBrowsing('');
            }}
            onClose={() => setBrowsing('')}
          />
        )}
      </div>
    </Modal>
  );
}
