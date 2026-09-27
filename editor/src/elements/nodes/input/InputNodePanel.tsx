import React from 'react';
import PathField, { FileTypesField } from '@/dialogs/PathField';
import { clip } from '@/authoring/TryItInline';
import { listAsRun, readFileAsRun } from '@/authoring/readAsRun';
import FolderListing from '../../fields/FolderListing';
import { errorText } from '@/api/errorText';
import { DANGER_TEXT, DIMMER, FIELD, MUTED, NEUTRAL_BUTTON, SUNKEN, TEXT } from '@/ui/theme';
import type { NodePanelProps } from '../../NodeGuiBuilder';
import { InputNodeGuiBuilder } from './InputNodeGuiBuilder';

/**
 * What a file input hands on, read the way a run reads it: the text every
 * node after it is shown before the graph has run. Shown when asked, since
 * reading is a trip to the engine, and forgotten when the path changes.
 */
function WhatItHandsOn({ path }: { path: string }) {
  const [read, setRead] = React.useState<{ text: string } | { error: string } | null>(null);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => setRead(null), [path]);

  const show = async () => {
    setBusy(true);
    try {
      setRead({ text: await readFileAsRun(path) });
    } catch (error) {
      setRead({ error: errorText(error, 'The file could not be read.') });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-1">
      <button className="text-xs px-2 py-1 rounded" style={{ ...NEUTRAL_BUTTON, opacity: busy || !path.trim() ? 0.5 : 1 }}
        disabled={busy || !path.trim()} onClick={show}
        title={path.trim() ? 'Read the file as a run reads it, and show what it hands on as its content' : 'Choose a file first'}>
        {busy ? 'Reading…' : read ? 'Read it again' : 'Show what it hands on'}
      </button>
      {read && 'error' in read && <p className="text-xs" style={{ color: DANGER_TEXT }}>{read.error}</p>}
      {read && 'text' in read && (
        <pre className="text-xs rounded px-2 py-1.5 whitespace-pre-wrap overflow-auto" style={{ background: SUNKEN, color: read.text ? TEXT : DIMMER, maxHeight: 200 }}>
          {read.text ? clip(read.text, 1500) : '(the file is empty)'}
        </pre>
      )}
    </div>
  );
}

/**
 * An input node: text, one file, or a folder -- and for a folder, its file
 * types and whether it looks into subfolders, then the list, drawn by the same
 * component a folder picker on a page is.
 *
 * What it reads is what every node after it is shown before the graph has run
 * (`InputNodeGuiBuilder.restingFile`), so there is no sample of its own to
 * attach and no second description of what the files hold.
 */
export default function InputNodePanel({ builder, node, setConfig }: NodePanelProps) {
  if (!(builder instanceof InputNodeGuiBuilder)) return null;
  const mode:'text' | 'file' | 'directory' =
    (node.config.input_mode || 'text') as 'text' | 'file' | 'directory';

  const isText = mode === 'text';
  const isDirectory = mode === 'directory';
  const path = String(node.config.value ?? '');

  const modeField = (
    <div>
      <label className="block text-xs font-medium mb-1" style={{ color: MUTED }}>Mode</label>
      {/* Its ports follow the mode, and the dialog re-derives them from it. */}
      <select
        className="w-full rounded-lg px-3 py-2 text-sm"
        style={FIELD}
        value={mode}
        onChange={(e) => setConfig('input_mode', e.target.value)}
      >
        <option value="text">Text (static value)</option>
        <option value="file">Single file (read content)</option>
        <option value="directory">Directory (list of files)</option>
      </select>
    </div>
  );

  const valueField = (
    <div>
      <label className="block text-xs font-medium mb-1" style={{ color: MUTED }}>
        {isText ? 'Text' : isDirectory ? 'Directory' : 'File'}
      </label>
      {/* Text in a box that keeps its line breaks: a one-line field dropped
          them at the first edit of a text pasted in. */}
      {isText ? (
        <textarea
          className="w-full rounded-lg px-3 py-2 text-sm resize-y"
          style={{ ...FIELD, minHeight: 72 }}
          value={path}
          onChange={(e) => setConfig('value', e.target.value)}
          placeholder="Enter default text…"
          aria-label="Text"
        />
      ) : (
        <PathField
          value={path}
          onChange={(picked) => setConfig('value', picked)}
          mode={isDirectory ? 'directory' : 'file'}
          extensions={node.config.extensions ?? ''}
          placeholder={isDirectory ? '/path/to/directory' : '/path/to/file'}
          ariaLabel={isDirectory ? 'Directory' : 'File'}
        />
      )}
      {/* The one setting this text used to promise without offering: the engine
          asks only when it is on (`runtimeRequirements`). */}
      <label className="flex items-center gap-2 mt-2 text-sm" style={{ color: MUTED }}>
        <input
          type="checkbox"
          checked={!!node.config.prompt_at_runtime}
          onChange={(e) => setConfig('prompt_at_runtime', e.target.checked)}
        />
        Ask for it when running (web, CLI, and deployed runs)
      </label>
      <p className="text-xs mt-1" style={{ color: DIMMER }}>
        {node.config.prompt_at_runtime
          ? `Every run asks for the ${isText ? 'text' : 'path'}, with what is above filled in.`
          : `Every run uses what is above. Tick to be asked each time instead.`}
      </p>
    </div>
  );

  const catchFailures = !isText && (
    <div>
      <label className="flex items-center gap-2 text-sm" style={{ color: MUTED }}>
        <input
          type="checkbox"
          checked={!!node.config.catch_errors}
          onChange={(e) => setConfig('catch_errors', e.target.checked)}
        />
        Catch a failed read instead of failing the node
      </label>
      <p className="text-xs mt-1" style={{ color: DIMMER }}>
        A missing or unreadable file fails this node, the way it always did. Turned on, it
        adds an <strong style={{ color: '#a78bfa' }}>error</strong> output port: empty on
        success, the reason otherwise.
      </p>
    </div>
  );

  // A file and a folder alike: the browser offers only these for a file, and a
  // folder's listing keeps only these. It was shown for a folder alone, while
  // the browser for one file filtered by it all the same.
  const typesField = !isText && (
    <FileTypesField value={node.config.extensions ?? ''} onChange={(extensions) => setConfig('extensions', extensions)} />
  );

  // A folder: its file types and its subfolders, then the list -- as a run
  // lists it, the way the folder picker on a page does.
  const listing = isDirectory && (
    <FolderListing
      recursive={!!node.config.recursive}
      onRecursive={(recursive) => setConfig('recursive', recursive)}
      noFolder={!path.trim()}
      list={() => listAsRun(node)}
      of={JSON.stringify([path, node.config.extensions ?? '', !!node.config.recursive])}
    />
  );

  return (
    <div className="space-y-4">
      {modeField}{valueField}{!isText && !isDirectory && <WhatItHandsOn path={path} />}{typesField}{listing}{catchFailures}
    </div>
  );
}
