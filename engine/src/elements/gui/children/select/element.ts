import { WidgetElement, type Widget } from '../../../../element.ts';
import { port } from '../../../port.ts';

export interface SelectConfig {
  value: string;
  options: string[];
}

/** One option per line; blank lines dropped, so a stray empty row is not a choice. */
function parseOptions(raw: string): string[] {
  return raw.split('\n').map((line) => line.trim()).filter(Boolean);
}

/**
 * One choice from a fixed list, picked on the page.
 *
 * The list is written once, in the block's own settings — not generated, not
 * wired in: a dropdown is furniture whose options a person decides, the same
 * way a `select_all_files` checkbox is a decision rather than a value. Its own
 * choice is what it emits; nothing flows into it.
 */
export class SelectElement extends WidgetElement<SelectConfig> {
  readonly widgetKind = 'select' as const;

  config(widget: Widget): SelectConfig {
    const options = parseOptions(String(widget.config.options ?? ''));
    const stored = String(widget.config.value ?? '');
    // A value from a retired option, or none yet: the first option is the
    // honest default, since that is what the dropdown itself would show.
    const value = options.includes(stored) ? stored : (options[0] ?? '');
    return { value, options };
  }

  ports(widget: Widget) {
    return { inputs: [], outputs: [port(`${widget.id}_out`, widget.label || widget.id, 'output', 'text')] };
  }

  async execute(widget: Widget) {
    return { [`${widget.id}_out`]: this.config(widget).value };
  }
}
