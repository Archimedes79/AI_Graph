import { WidgetElement, type Runtime, type Widget } from '../../../../element.ts';
import { logicFrom, Logic } from '../../../../logic.ts';
import { selectFiles } from '../../../files.ts';
import { port } from '../../../port.ts';
import { SELECTOR_FIELDS, SELECTOR_GENERATION } from '../../../../generation.ts';
import type { Generation } from '../../../../generation.ts';

export interface PickerConfig {
  /** The chosen path. */
  path: string;
  directory: boolean;
  recursive: boolean;
  /** Comma-separated suffixes a directory listing keeps. */
  extensions: string;
  selectAll: boolean;
}

/**
 * Choosing a file or a folder.
 *
 * Emits a path, or in directory mode a list of them. The listing can be
 * narrowed by an authored selector — the same behaviour the input node has one
 * level up, through the same code, because it is the same behaviour.
 */
export class InputPickerElement extends WidgetElement<PickerConfig> {
  readonly widgetKind = 'input_picker' as const;

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
    return logicFrom(widget, 'code', SELECTOR_FIELDS, 'this file selector');
  }

  /** The same declaration the input node hands out; see `generation.ts`. */
  override generation(): Generation {
    return SELECTOR_GENERATION;
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
}
