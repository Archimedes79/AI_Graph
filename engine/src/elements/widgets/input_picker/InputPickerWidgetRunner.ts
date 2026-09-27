import { WidgetRunner, type Widget } from '../../WidgetRunner.ts';
import { type Runtime } from '../../Runtime.ts';
import { listFolder } from '../../folderListing.ts';
import { port } from '../../port.ts';

export interface PickerConfig {
  /** The chosen path. */
  path: string;
  directory: boolean;
  recursive: boolean;
  /** Comma-separated suffixes a directory listing keeps. */
  extensions: string;
}

/**
 * Choosing a file or a folder.
 *
 * Emits a path, or in directory mode the folder's listing -- its file types,
 * its subfolders when asked: the same listing the input node makes one level
 * up, through the same function, because it is the same behaviour.
 */
export class InputPickerWidgetRunner extends WidgetRunner<PickerConfig> {
  readonly widgetKind = 'input_picker' as const;

  config(widget: Widget): PickerConfig {
    const c = widget.config;
    return {
      path: String(c.value ?? ''),
      directory: c.mode === 'directory',
      recursive: c.recursive === true,
      extensions: String(c.extensions ?? ''),
    };
  }

  ports(widget: Widget) {
    const settings = this.config(widget);
    return {
      inputs: [],
      outputs: [port(`${widget.id}_out`, widget.label || widget.id, 'output', 'file_path', settings.directory)],
    };
  }

  async execute(widget: Widget, _inputs: Record<string, unknown>, runtime: Runtime) {
    const out = `${widget.id}_out`;
    const settings = this.config(widget);
    if (!settings.path) return { [out]: settings.directory ? [] : null };
    if (!settings.directory) return { [out]: runtime.files.resolve(settings.path) };
    return { [out]: await listFolder(settings.path, settings, runtime) };
  }

  // ── Build time ────────────────────────────────────────────────────────────

  override graphAuthorNote(): string {
    return 'mode file|directory, value = the path; a directory hands on every file in the folder -- '
      + 'extensions (e.g. ".csv, .txt") keeps only those types, recursive: true looks into subfolders too';
  }
}
