import { useEffect, useState } from 'react';
import type { Requirement } from '@/api/client';
import Modal from '@/ui/Modal';
import PathField from './PathField';
import { DIMMER, FIELD, MUTED, NEUTRAL_BUTTON, PRIMARY_BUTTON } from '@/ui/theme';

interface RequirementsDialogProps {
  requirements: Requirement[] | null;
  onSubmit: (values: Record<string, string>) => void;
  onCancel: () => void;
}

const KIND_ICON: Record<string, string> = { text: '📝', file: '📄', directory: '📁' };

/**
 * What 📂 Browse… picks for a path a run asks for. A file an output writes is
 * chosen as one to save: it may not exist yet, and a browser that picks only
 * existing files could not name it.
 */
export function browsesFor(req: Pick<Requirement, 'kind' | 'direction'>): 'file' | 'directory' | 'save' {
  if (req.kind === 'directory') return 'directory';
  return req.direction === 'output' ? 'save' : 'file';
}

/** The "before running" window: the values a graph asks for before it can run. */
export default function RequirementsDialog({ requirements, onSubmit, onCancel }: RequirementsDialogProps) {
  const [values, setValues] = useState<Record<string, string>>({});

  // Answers are kept by each question's own key: the name of the value the
  // engine writes them back as (`applyValues`).
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
  const set = (key: string, value: string) => setValues((prev) => ({ ...prev, [key]: value }));

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
            {req.kind === 'text' ? (
              <input
                className="w-full rounded-lg px-3 py-2 text-sm"
                style={FIELD}
                value={values[req.key] ?? ''}
                onChange={(e) => set(req.key, e.target.value)}
                placeholder="Enter text…"
                autoFocus={index === 0}
              />
            ) : (
              // Typing an absolute path from memory was the only way to answer
              // this dialog; a path field offers a picker (`browsesFor`).
              <PathField
                value={values[req.key] ?? ''}
                onChange={(path) => set(req.key, path)}
                mode={browsesFor(req)}
                placeholder={req.kind === 'directory' ? '/path/to/directory' : '/path/to/file'}
                mono
                autoFocus={index === 0}
              />
            )}
          </div>
        ))}
      </div>
    </Modal>
  );
}
