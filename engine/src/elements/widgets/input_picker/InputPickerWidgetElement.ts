import { WidgetElement, type Widget } from '../../WidgetElement.ts';
import type { TextFile } from '../../Element.ts';
import { type Runtime } from '../../Runtime.ts';
import { logicFrom, Logic } from '../../../authoring/logic.ts';
import { selectFiles } from '../../fileSelection.ts';
import { port } from '../../port.ts';
import { SELECTOR_FIELDS, SELECTOR_GENERATION } from '../../../authoring/generation.ts';
import type { Generation } from '../../../authoring/generation.ts';

export interface PickerConfig {
  /** The chosen path. */
  path: string;
  directory: boolean;
  recursive: boolean;
  /** Comma-separated suffixes a directory listing keeps. */
  extensions: string;
  selectAll: boolean;
}

/** What this keeps in files of its own in a project folder: see `Element.texts`. */
const SELECTOR_TEXTS: readonly TextFile[] = [
  { field: 'selector_code', file: 'select.js' },
  { field: 'selector_prompt', file: 'task.md' },
];

/**
 * Choosing a file or a folder.
 *
 * Emits a path, or in directory mode a list of them. The listing can be
 * narrowed by an authored selector — the same behaviour the input node has one
 * level up, through the same code, because it is the same behaviour.
 */
export class InputPickerWidgetElement extends WidgetElement<PickerConfig> {
  readonly widgetKind = 'input_picker' as const;

  override texts(): readonly TextFile[] {
    return SELECTOR_TEXTS;
  }

  config(widget: Widget): PickerConfig {
    const c = widget.config;
    return {
      path: String(c.value ?? ''),
      directory: c.mode === 'directory',
      recursive: c.recursive === true,
      extensions: String(c.extensions ?? ''),
      selectAll: c.select_all_files !== false,
    };
  }

  override logic(widget: Widget): Logic | undefined {
    if (!this.config(widget).directory) return undefined;
    return logicFrom(widget, 'code', SELECTOR_FIELDS);
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

    // Literally the function the input node calls: listing a folder, filtering
    // it and narrowing it with an authored selector is one behaviour, and this
    // block had drifted into a second copy of it.
    return { [out]: await selectFiles(this.logic(widget), settings, settings.path, runtime) };
  }

  // ── Build time ────────────────────────────────────────────────────────────

  /** The same declaration the input node hands out; see `generation.ts`. */
  override generation(): Generation {
    return SELECTOR_GENERATION;
  }
}
