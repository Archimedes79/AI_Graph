import React, { useState } from 'react';
import { errorText } from '@/api/errorText';
import FourSteps, { TaskField } from './FourSteps';
import GeneratedBody from './GeneratedBody';
import TryItInline from './TryItInline';
import type { TryResult } from './TryItInline';
import type { ElementGeneration, FieldAccess } from './generation';
import { DANGER_TEXT, DIMMER, MUTED, NEUTRAL_BUTTON, SUNKEN, TEXT } from '@/ui/theme';

/** How many paths of a listing are shown; the rest are counted. */
const SHOWN = 40;

/** The files a listing or a try came to, from either shape: what a block hands on, or a node's `files` output. */
function filesOf(result: { shown?: unknown; outputs?: Record<string, unknown> }): string[] {
  const files = Array.isArray(result.shown) ? result.shown : result.outputs?.files;
  return Array.isArray(files) ? files.map(String) : [];
}

function FileList({ files }: { files: string[] }) {
  return (
    <div className="text-xs rounded px-2 py-1.5 mt-1" style={{ background: SUNKEN }}>
      <p style={{ color: MUTED }}>{files.length === 1 ? '1 file' : `${files.length} files`}</p>
      {files.length > 0 && (
        <pre className="whitespace-pre-wrap overflow-auto" style={{ color: TEXT, maxHeight: 180 }}>
          {files.slice(0, SHOWN).join('\n')}
          {files.length > SHOWN ? `\n… and ${files.length - SHOWN} more` : ''}
        </pre>
      )}
    </div>
  );
}

interface Props<S> {
  /** Step 1, as the element keeps it: the folder, its file types, whether it looks into subfolders. */
  folder: React.ReactNode;
  /** No folder is chosen yet: there is nothing to list, and nothing to try. */
  noFolder: boolean;
  /** Every file listed is handed on, and no code runs -- as a run reads the element's setting. */
  selectAll: boolean;
  onSelectAll: (all: boolean) => void;
  generation: ElementGeneration<S>;
  /** The node or the block the selector belongs to: what its listing is asked of (`fetchSample`). */
  subject: S;
  fields: FieldAccess;
  generating: boolean;
  message?: string;
  onGenerate: () => void;
  /** It, run by itself the way a run runs it: the files it hands on. */
  tryIt: () => Promise<TryResult>;
  preview?: React.ReactNode;
  sent?: React.ReactNode;
  openInEditor?: React.ReactNode;
  /** Its fields sit on a raised surface, as a block's do. */
  onSurface?: boolean;
}

/**
 * Choosing files from a folder by code, in the four steps -- the same for an
 * input node in directory mode and for a folder picker on a page, which are
 * one behaviour at two levels (`fileSelection.ts`).
 *
 * The example it is written against is not typed and not picked: it is the
 * folder's listing, which is what the code is handed as `files` -- the same
 * listing ✨ is shown and tries the code on (`ElementGeneration.fetchSample`).
 * It used to offer a 📎 file, whose content was the wrong shape for a
 * selector, and nothing to try the selector on at all.
 */
export default function SelectorSteps<S>({
  folder, noFolder, selectAll, onSelectAll, generation, subject, fields, generating, message, onGenerate,
  tryIt, preview, sent, openInEditor, onSurface,
}: Props<S>) {
  const [listing, setListing] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');

  const list = async () => {
    if (!generation.fetchSample) return;
    setBusy(true); setFailure('');
    try {
      const got = await generation.fetchSample(subject);
      setListing(got ? filesOf({ outputs: got.values }) : []);
    } catch (reason) {
      setFailure(errorText(reason, 'The folder could not be listed.'));
    } finally {
      setBusy(false);
    }
  };

  const comesIn = (
    <>
      {folder}
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs font-medium" style={{ color: MUTED, flex: '1 1 8rem' }}>Example input: the files it lists</label>
          {generation.fetchSample && (
            <button className="text-xs px-2 py-1 rounded" style={{ ...NEUTRAL_BUTTON, opacity: busy || noFolder ? 0.5 : 1 }}
              disabled={busy || noFolder} onClick={list}
              title={noFolder ? 'Choose a folder first' : 'List the folder the way a run lists it: its file types, and its subfolders when it looks into them'}>
              {busy ? 'Listing…' : '⟳ List them'}
            </button>
          )}
        </div>
        {listing ? <FileList files={listing} /> : (
          <p className="text-xs" style={{ color: DIMMER }}>
            What the code is handed as <code>files</code>, and what ✨ writes it against: the folder's listing, made when it is needed.
          </p>
        )}
        {failure && <p className="text-xs" style={{ color: DANGER_TEXT }}>{failure}</p>}
      </div>
    </>
  );

  const comesOut = (
    <div>
      <label className="flex items-center gap-2 text-sm" style={{ color: MUTED }}>
        <input type="checkbox" checked={selectAll} onChange={(event) => onSelectAll(event.target.checked)} aria-label="Every file it lists" />
        Every file it lists
      </label>
      <p className="text-xs mt-0.5" style={{ color: DIMMER }}>
        {selectAll
          ? 'Hands on every file in the listing, as a list of paths. Untick it to choose some of them by code.'
          : 'Hands on the files the code in step 4 keeps: a list of paths out of the listing, returned as {"files": [...]}.'}
      </p>
    </div>
  );

  return (
    <FourSteps
      comesIn={comesIn}
      comesInHint="The folder, and the files it lists: what the code is handed, and one example of it."
      comesOut={comesOut}
      comesOutHint="A list of file paths -- which ones is the only choice."
      task={{
        title: 'Which files to keep?',
        field: selectAll
          ? <p className="text-xs" style={{ color: DIMMER }}>Every file is kept: there is nothing to say here until step 2 asks for some of them.</p>
          : <TaskField generation={generation} fields={fields} onSurface={onSurface} />,
      }}
      bodyHidden={selectAll}
      body={{
        title: 'Code',
        hint: 'Empty, every file is kept.',
        content: (
          <>
            <GeneratedBody
              generation={generation}
              fields={fields}
              generating={generating}
              message={message}
              onGenerate={onGenerate}
              preview={preview}
              sent={sent}
            />
            <TryItInline
              canRun={!noFolder}
              whyNot="Choose a folder in step 1 first."
              run={tryIt}
              renderResult={(result) => <FileList files={filesOf(result)} />}
            />
            {openInEditor}
          </>
        ),
      }}
    />
  );
}
