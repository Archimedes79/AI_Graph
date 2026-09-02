import React from 'react';
import { suggestedFileName } from './authoredFileName';
import { DIMMER, MUTED } from '../../ui/theme';

interface KeepInFileOptionProps {
  /** The element's name — the file is named after it. */
  label: string;
  /** Current file name, or '' when the text lives in the graph. */
  fileName: string;
  /** `.py`, `.js`, `.md` — whatever this element's content deserves. */
  extension: string;
  /** How to refer to the content: "this code", "this system prompt". */
  what: string;
  /** Where the file lives, for the hint: `<graph>.nodes/` or `<graph>.nodes/<Node>/`. */
  folderHint: string;
  onChange: (fileName: string) => void;
}

/**
 * "Keep this in a file beside the graph", for a node or for a widget.
 *
 * Deliberately plain props rather than a node: a widget is the same element one
 * level down, wants exactly this control with exactly this behaviour, and the
 * only things that differ — the name, the extension, the noun and the folder —
 * are the four props. A second copy of this component for widgets is precisely
 * the duplication the element contract exists to avoid.
 */
export default function KeepInFileOption({
  label, fileName, extension, what, folderHint, onChange,
}: KeepInFileOptionProps) {
  return (
    <div>
      <label className="flex items-center gap-2 text-sm" style={{ color: MUTED }}>
        <input
          type="checkbox"
          checked={!!fileName}
          onChange={(e) => onChange(e.target.checked ? suggestedFileName(label, extension) : '')}
        />
        Keep {what} in a file beside the graph
      </label>
      <p className="text-xs mt-1" style={{ color: DIMMER }}>
        {fileName ? (
          <>
            Saved as <span className="font-mono" style={{ color: MUTED }}>{folderHint}{fileName}</span> — edit it in
            any editor; the graph reads it back when it opens. The file is named after this element, so renaming it
            renames the file.
          </>
        ) : (
          <>
            Off, so it lives inside the graph JSON. Turning it on makes it a real{' '}
            <span className="font-mono">{extension}</span> file you can open in VS Code, with a readable diff instead
            of an escaped JSON string.
          </>
        )}
      </p>
    </div>
  );
}
