import React, { useState } from 'react';
import FileBrowserDialog from './FileBrowserDialog';
import { FIELD, FIELD_ON_SURFACE, MUTED, NEUTRAL_BUTTON } from '@/ui/theme';

interface PathFieldProps {
  value: string;
  onChange: (path: string) => void;
  /**
   * What 📂 Browse… picks: a file, a folder, or where to save a file -- which
   * starts with the name in the box filled in (`nameToSave`).
   */
  mode: 'file' | 'directory' | 'save';
  /** The file types the browser offers for a file, e.g. ".md, .txt". */
  extensions?: string;
  placeholder?: string;
  ariaLabel?: string;
  /** Sits on a raised surface, as a block's settings do: the surface's colour and the smaller size. */
  onSurface?: boolean;
  /** The smaller size, on the page's own background. */
  compact?: boolean;
  mono?: boolean;
  autoFocus?: boolean;
  /** Shown, not typed into: a picker holding a list of files has no one path to edit. */
  readOnly?: boolean;
  /** A path was picked in the browser -- besides `onChange`, for a page where picking is the event. */
  onPicked?: (path: string) => void;
  onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  /** What stands after 📂 Browse… on the same line: the page's ✕. */
  children?: React.ReactNode;
}

/**
 * The name a file to be saved starts with in the browser: the one in the box.
 * The browser opens in that file's folder, and choosing another folder must
 * not lose the name, which it did.
 */
export function nameToSave(path: string): string | undefined {
  return path.split(/[\\/]/).pop() || undefined;
}

/**
 * A path, typed or picked: the box, 📂 Browse… beside it, and the file
 * browser it opens, which puts what is picked into the box.
 *
 * Written out once. Each place that asks for a path -- where an input node
 * reads, where an output node writes, a folder picker's panel and the picker
 * on the page, the values a run asks for first -- had its own copy, with its
 * own open/closed state and its own spelling of the button.
 */
export default function PathField({
  value, onChange, mode, extensions, placeholder, ariaLabel,
  onSurface, compact, mono, autoFocus, readOnly, onPicked, onKeyDown, children,
}: PathFieldProps) {
  const [browsing, setBrowsing] = useState(false);
  const size = onSurface || compact ? 'px-2 py-1.5' : 'px-3 py-2';

  return (
    <>
      <div className="flex items-center gap-2">
        <input
          className={`flex-1 min-w-0 rounded-lg ${size} text-sm${mono ? ' font-mono' : ''}`}
          style={onSurface ? FIELD_ON_SURFACE : FIELD}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          aria-label={ariaLabel}
          autoFocus={autoFocus}
          readOnly={readOnly}
        />
        <button
          type="button"
          className={`text-xs ${size} rounded-lg flex-shrink-0`}
          style={NEUTRAL_BUTTON}
          onClick={() => setBrowsing(true)}
        >
          📂 Browse…
        </button>
        {children}
      </div>
      {browsing && (
        <FileBrowserDialog
          mode={mode}
          initialPath={value}
          defaultName={mode === 'save' ? nameToSave(value) : undefined}
          extensions={extensions}
          onPick={(picked) => { onChange(picked); setBrowsing(false); onPicked?.(picked); }}
          onClose={() => setBrowsing(false)}
        />
      )}
    </>
  );
}

/**
 * Which kinds of file a path field takes: what 📂 Browse… offers for a file,
 * and what a folder's listing keeps. The same setting on an input node and on
 * a picker on a page, so it is asked in the same words.
 */
export function FileTypesField({ value, onChange, onSurface }: {
  value: string;
  onChange: (extensions: string) => void;
  onSurface?: boolean;
}) {
  return (
    <div>
      <label className="block text-xs font-medium mb-1" style={{ color: MUTED }}>
        File types (comma-separated, e.g. .md, .txt)
      </label>
      <input
        className={`w-full rounded-lg ${onSurface ? 'px-2 py-1.5' : 'px-3 py-2'} text-sm font-mono`}
        style={onSurface ? FIELD_ON_SURFACE : FIELD}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Leave empty for all file types"
        aria-label="File types"
      />
    </div>
  );
}
