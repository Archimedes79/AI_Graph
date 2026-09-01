// The blocks a page is built from.
//
// Each is an element like any other, one level down: it declares its ports,
// owns its settings, and runs. That is what makes a gui node "an object
// hierarchy whose lowest level is again made of graph elements" rather than a
// special case the executor has to know about.

import {
  DisplayWidget, StaticWidget, WidgetElement,
  type AuthoredFile, type Runtime, type Widget,
} from '../element.js';
import type { Port } from '../graph.js';

function port(id: string, name: string, kind: 'input' | 'output', dataType: Port['data_type'], multi = false): Port {
  return { id, name, kind, data_type: dataType, multi, required: false, description: '' };
}

// ---------------------------------------------------------------------------
// Page furniture
// ---------------------------------------------------------------------------

export type TextRole = 'heading' | 'body' | 'caption';

export interface TextConfig {
  text: string;
  role: TextRole;
}

/** A heading, a paragraph or a caption: one block, three formattings. */
export class TextWidgetElement extends StaticWidget<TextConfig> {
  readonly widgetKind = 'text' as const;

  config(widget: Widget): TextConfig {
    const role = String(widget.config.mode ?? 'body');
    return {
      text: String(widget.config.value ?? ''),
      role: (['heading', 'body', 'caption'].includes(role) ? role : 'body') as TextRole,
    };
  }
}

export interface RuleConfig {
  vertical: boolean;
}

/** A rule between sections. Holds nothing at all. */
export class DividerElement extends StaticWidget<RuleConfig> {
  readonly widgetKind = 'divider' as const;
  config(widget: Widget): RuleConfig {
    return { vertical: widget.config.mode === 'vertical' };
  }
}

/** Air between sections — the block that says one thing ended. */
export class SpacerElement extends StaticWidget<RuleConfig> {
  readonly widgetKind = 'spacer' as const;
  config(widget: Widget): RuleConfig {
    return { vertical: widget.config.mode === 'vertical' };
  }
}

// ---------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------

export interface PickerConfig {
  /** The chosen path. */
  path: string;
  directory: boolean;
  recursive: boolean;
  /** Comma-separated suffixes a directory listing keeps. */
  extensions: string;
  selectAll: boolean;
  selectorCode: string;
  language: string;
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
      selectorCode: String(c.selector_code ?? ''),
      language: String(c.language ?? 'python'),
    };
  }

  override authoredFile(widget: Widget): AuthoredFile | undefined {
    if (!this.config(widget).directory) return undefined;
    return {
      bodyField: 'selector_code',
      nameField: 'code_file',
      extension: this.config(widget).language.startsWith('py') ? '.py' : '.js',
      what: 'this file selector',
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

    const extensions = settings.extensions
      .split(',').map((e) => e.trim()).filter(Boolean)
      .map((e) => (e.startsWith('.') ? e : `.${e}`));
    let files = await runtime.files.list(settings.path, {
      recursive: settings.recursive,
      extensions: extensions.length ? extensions : undefined,
    });

    if (!settings.selectAll && settings.selectorCode.trim()) {
      const chosen = await this.runSnippet(widget, { files }, runtime, settings.selectorCode);
      if (Array.isArray(chosen.files)) files = chosen.files.map(String);
    }
    return { [out]: files };
  }
}

export type TextIoRole = 'input' | 'output' | 'both';

export interface TextIoConfig {
  value: string;
  role: TextIoRole;
}

/** A box of text: typed into, shown in, or both. */
export class TextIoElement extends WidgetElement<TextIoConfig> {
  readonly widgetKind = 'text_io' as const;

  config(widget: Widget): TextIoConfig {
    const role = String(widget.config.mode ?? 'both');
    return {
      value: String(widget.config.value ?? ''),
      role: (['input', 'output', 'both'].includes(role) ? role : 'both') as TextIoRole,
    };
  }

  ports(widget: Widget) {
    const { role } = this.config(widget);
    const name = widget.label || widget.id;
    const inPort = port(`${widget.id}_in`, name, 'input', 'text');
    const outPort = port(`${widget.id}_out`, name, 'output', 'text');
    if (role === 'input') return { inputs: [], outputs: [outPort] };
    if (role === 'output') return { inputs: [inPort], outputs: [] };
    return { inputs: [inPort], outputs: [outPort] };
  }

  async execute(widget: Widget, inputs: Record<string, unknown>) {
    const { role, value } = this.config(widget);
    if (role === 'output') return {};

    const incoming = inputs[`${widget.id}_in`];
    if (role === 'input') return { [`${widget.id}_out`]: value };

    // "both": what the user typed wins; an empty box falls back to what arrived.
    if (value) return { [`${widget.id}_out`]: value };
    if (Array.isArray(incoming)) return { [`${widget.id}_out`]: incoming.map(String).join('\n') };
    return { [`${widget.id}_out`]: incoming ?? '' };
  }
}

// ---------------------------------------------------------------------------
// Displays
// ---------------------------------------------------------------------------

export interface TransformConfig {
  code: string;
  language: string;
}

/**
 * A display with an optional transform: whatever arrives is reshaped into what
 * this kind of block can draw.
 *
 * Nothing downstream depends on the result, so a failing transform shows its
 * message in the block instead of failing the node — which used to take every
 * sibling block's output down with it.
 */
abstract class TransformingDisplay extends DisplayWidget<TransformConfig> {
  config(widget: Widget): TransformConfig {
    return {
      code: String(widget.config.code ?? ''),
      language: String(widget.config.language ?? 'python'),
    };
  }

  override authoredFile(): AuthoredFile {
    return { bodyField: 'code', nameField: 'code_file', extension: '.py', what: 'this transform' };
  }
}

/** Points to draw: a list of numbers, or of {label, value}. */
export class PlotWindowElement extends TransformingDisplay {
  readonly widgetKind = 'plot_window' as const;
}

/** An image, by path. */
export class ImageViewElement extends TransformingDisplay {
  readonly widgetKind = 'image_view' as const;
}

/** Rows to show, as a list of objects. */
export class TableElement extends TransformingDisplay {
  readonly widgetKind = 'table' as const;
}

export const WIDGET_ELEMENTS = [
  new TextWidgetElement(),
  new DividerElement(),
  new SpacerElement(),
  new InputPickerElement(),
  new TextIoElement(),
  new PlotWindowElement(),
  new ImageViewElement(),
  new TableElement(),
];
