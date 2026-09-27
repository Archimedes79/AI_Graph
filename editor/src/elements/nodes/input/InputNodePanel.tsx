import React from 'react';
import FileBrowserDialog from '@/dialogs/FileBrowserDialog';
import SelectorSteps from '@/authoring/SelectorSteps';
import { clip } from '@/authoring/TryItInline';
import { readFileAsRun, runAlone } from '@/authoring/readAsRun';
import { errorText } from '@/api/errorText';
import { DANGER_TEXT, DIMMER, FIELD, MUTED, NEUTRAL_BUTTON, SUNKEN, TEXT } from '@/ui/theme';
import type { NodePanelProps } from '../../NodeGuiBuilder';

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
 * An input node: text, one file, or a folder -- and for a folder, the files it
 * keeps, chosen by code in the four steps a folder picker on a page is built
 * in, drawn by the same component.
 *
 * What it reads is what every node after it is shown before the graph has run
 * (`InputNodeGuiBuilder.restingFile`), so there is no sample of its own to
 * attach and no second description of what the files hold.
 */
export default function InputNodePanel({
  node, setConfig, generation, fields, generating, message, onGenerate, steps,
}: NodePanelProps) {
  const mode: 'text' | 'file' | 'directory' =
    (node.config.input_mode || 'text') as 'text' | 'file' | 'directory';

  const [browsing, setBrowsing] = React.useState(false);

  const isText = mode === 'text';
  const isDirectory = mode === 'directory';
  const path = String(node.config.value ?? '');
  const earlierFile = String(node.config.example_file ?? '').trim();
  const saidBefore = String(node.config.output_format_prompt ?? '').trim();

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
      <div className="flex items-center gap-2">
        {/* Text in a box that keeps its line breaks: a one-line field dropped
            them at the first edit of a text pasted in. */}
        {isText ? (
          <textarea
            className="flex-1 min-w-0 rounded-lg px-3 py-2 text-sm resize-y"
            style={{ ...FIELD, minHeight: 72 }}
            value={path}
            onChange={(e) => setConfig('value', e.target.value)}
            placeholder="Enter default text…"
            aria-label="Text"
          />
        ) : (
          <input
            className="flex-1 min-w-0 rounded-lg px-3 py-2 text-sm"
            style={FIELD}
            value={path}
            onChange={(e) => setConfig('value', e.target.value)}
            placeholder={isDirectory ? '/path/to/directory' : '/path/to/file'}
            aria-label={isDirectory ? 'Directory' : 'File'}
          />
        )}
        {!isText && (
          <button
            type="button"
            className="text-xs px-3 py-2 rounded-lg flex-shrink-0"
            style={NEUTRAL_BUTTON}
            onClick={() => setBrowsing(true)}
          >
            📂 Browse…
          </button>
        )}
      </div>
      {browsing && (
        <FileBrowserDialog
          mode={isDirectory ? 'directory' : 'file'}
          initialPath={path}
          extensions={node.config.extensions ?? ''}
          onPick={(picked) => { setConfig('value', picked); setBrowsing(false); }}
          onClose={() => setBrowsing(false)}
        />
      )}
      {/* An example file the 📎 of an older version attached: what the nodes
          after this one were meant to be shown. It still is, while no file is
          set above; here it can be made the file, or let go. */}
      {!isText && earlierFile && (
        <p className="text-xs mt-1 flex flex-wrap items-center gap-2" style={{ color: DIMMER }}>
          <span className="flex-1 min-w-0">An example file was attached here before: {earlierFile}</span>
          {!isDirectory && !path.trim() && (
            <button className="text-xs px-2 py-0.5 rounded" style={NEUTRAL_BUTTON} onClick={() => setConfig('value', earlierFile)}>
              Read this file
            </button>
          )}
          <button className="text-xs px-2 py-0.5 rounded" style={NEUTRAL_BUTTON} onClick={() => setConfig('example_file', '')}
            aria-label="Drop the example file from before">
            ✕
          </button>
        </p>
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

  // What an older version let a person say the files contain. Nothing asks
  // for it now -- what a file holds is read from it -- but what was said is
  // still told to the nodes after this one, so it is shown, and can be dropped.
  const said = !isText && saidBefore && (
    <p className="text-xs flex items-start gap-1.5" style={{ color: DIMMER }}>
      <span className="flex-1 min-w-0">Said before about what the files contain: “{saidBefore}”</span>
      <button className="text-xs px-1 rounded flex-shrink-0" style={NEUTRAL_BUTTON}
        title="The nodes after this one are still told it. Drop it."
        aria-label="Drop what was said about the files"
        onClick={() => { setConfig('output_format_prompt', ''); setConfig('output_format', undefined); }}>
        ✕
      </button>
    </p>
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
    <div>
      <label className="block text-xs font-medium mb-1" style={{ color: MUTED }}>
        File types (comma-separated, e.g. .md, .txt)
      </label>
      <input
        className="w-full rounded-lg px-3 py-2 text-sm font-mono"
        style={FIELD}
        value={node.config.extensions ?? ''}
        onChange={(e) => setConfig('extensions', e.target.value)}
        placeholder="Leave empty for all file types"
        aria-label="File types"
      />
    </div>
  );

  if (!isDirectory || !generation || !steps) {
    return (
      <div className="space-y-4">
        {modeField}{valueField}{!isText && !isDirectory && <WhatItHandsOn path={path} />}{typesField}{said}{catchFailures}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {modeField}
      <SelectorSteps
        folder={(
          <div className="space-y-3">
            {valueField}
            {typesField}
            <label className="flex items-center gap-2 text-sm" style={{ color: MUTED }}>
              <input
                type="checkbox"
                checked={!!node.config.recursive}
                onChange={(e) => setConfig('recursive', e.target.checked)}
              />
              Look into subfolders too
            </label>
            {said}
          </div>
        )}
        noFolder={!path.trim()}
        selectAll={node.config.select_all_files !== false}
        onSelectAll={(all) => setConfig('select_all_files', all)}
        generation={generation}
        subject={node}
        fields={fields}
        generating={generating}
        message={message}
        onGenerate={onGenerate}
        tryIt={() => runAlone(node)}
        preview={steps.preview}
        sent={steps.sent}
        openInEditor={steps.openInEditor}
      />
      {catchFailures}
    </div>
  );
}
