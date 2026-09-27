import PathField, { FileTypesField } from '@/dialogs/PathField';
import { listAsRun } from '@/authoring/readAsRun';
import FolderListing from '../../fields/FolderListing';
import { DIMMER, FIELD, MUTED } from '@/ui/theme';
import type { NodePanelProps } from '../../NodeGuiBuilder';
import { InputNodeGuiBuilder } from './InputNodeGuiBuilder';

/**
 * An input node: a text, or a folder -- and for a folder, its file types and
 * whether it looks into subfolders, then the list, drawn by the same
 * component a folder picker on a page is.
 *
 * It reads no file. A node that wants a file's text reads it at its own input
 * ("Read the file at this path"), and a text here holding the path, wired into
 * that input, says which file.
 */
export default function InputNodePanel({ builder, node, setConfig }: NodePanelProps) {
  if (!(builder instanceof InputNodeGuiBuilder)) return null;
  const isDirectory = node.config.input_mode === 'directory';
  const value = String(node.config.value ?? '');

  const modeField = (
    <div>
      <label className="block text-xs font-medium mb-1" style={{ color: MUTED }}>Mode</label>
      {/* Its ports follow the mode, and the dialog re-derives them from it. */}
      <select
        className="w-full rounded-lg px-3 py-2 text-sm"
        style={FIELD}
        value={isDirectory ? 'directory' : 'text'}
        onChange={(e) => setConfig('input_mode', e.target.value)}
        aria-label="Mode"
      >
        <option value="text">Text</option>
        <option value="directory">Folder (list of files)</option>
      </select>
    </div>
  );

  const valueField = (
    <div>
      <label className="block text-xs font-medium mb-1" style={{ color: MUTED }}>
        {isDirectory ? 'Folder' : 'Text'}
      </label>
      {/* Text in a box that keeps its line breaks: a one-line field dropped
          them at the first edit of a text pasted in. */}
      {isDirectory ? (
        <PathField
          value={value}
          onChange={(picked) => setConfig('value', picked)}
          mode="directory"
          extensions={node.config.extensions ?? ''}
          placeholder="/path/to/folder"
          ariaLabel="Directory"
        />
      ) : (
        <textarea
          className="w-full rounded-lg px-3 py-2 text-sm resize-y"
          style={{ ...FIELD, minHeight: 72 }}
          value={value}
          onChange={(e) => setConfig('value', e.target.value)}
          placeholder="Enter default text…"
          aria-label="Text"
        />
      )}
      {!isDirectory && (
        <p className="text-xs mt-1" style={{ color: DIMMER }}>
          A file's path is a text too: wired into an input that reads the file at its path, that file is read.
        </p>
      )}
      {/* The engine asks only when this is on (`runtimeRequirements`). */}
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
          ? `Every run asks for the ${isDirectory ? 'folder' : 'text'}, with what is above filled in.`
          : 'Every run uses what is above. Tick to be asked each time instead.'}
      </p>
    </div>
  );

  if (!isDirectory) return <div className="space-y-4">{modeField}{valueField}</div>;

  return (
    <div className="space-y-4">
      {modeField}
      {valueField}
      <FileTypesField value={node.config.extensions ?? ''} onChange={(extensions) => setConfig('extensions', extensions)} />
      {/* Its file types and its subfolders, then the list -- as a run lists
          it, the way the folder picker on a page does. */}
      <FolderListing
        recursive={!!node.config.recursive}
        onRecursive={(recursive) => setConfig('recursive', recursive)}
        noFolder={!value.trim()}
        list={() => listAsRun(node)}
        of={JSON.stringify([value, node.config.extensions ?? '', !!node.config.recursive])}
      />
      <div>
        <label className="flex items-center gap-2 text-sm" style={{ color: MUTED }}>
          <input
            type="checkbox"
            checked={!!node.config.catch_errors}
            onChange={(e) => setConfig('catch_errors', e.target.checked)}
          />
          Catch a failed listing instead of failing the node
        </label>
        <p className="text-xs mt-1" style={{ color: DIMMER }}>
          A folder that is not there fails this node, the way it always did. Turned on, it
          adds an <strong style={{ color: '#a78bfa' }}>error</strong> output port: empty on
          success, the reason otherwise.
        </p>
      </div>
    </div>
  );
}
