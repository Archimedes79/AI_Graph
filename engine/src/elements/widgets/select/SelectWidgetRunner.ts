import { WidgetRunner, type Widget } from '../../WidgetRunner.ts';
import { port } from '../../port.ts';
import { selectChoice, selectOptions } from './choice.ts';

export interface SelectConfig {
  value: string;
  options: string[];
}

/**
 * One choice from a fixed list, picked on the page.
 *
 * The list is written once, in the block's own settings — not generated, not
 * wired in: a dropdown is furniture whose options a person decides, the same
 * way a folder's file types are a decision rather than a value. Its own
 * choice is what it emits; nothing flows into it.
 */
export class SelectWidgetRunner extends WidgetRunner<SelectConfig> {
  readonly widgetKind = 'select' as const;

  config(widget: Widget): SelectConfig {
    const options = selectOptions(widget.config.options);
    return { value: selectChoice(options, widget.config.value), options };
  }

  /**
   * Its one output, said in words: the choices it can hand on. A node wired to
   * a dropdown is written by ✨ against its port's description, and "text" is
   * all an empty one says -- so code compared the choice with values the
   * dropdown never offers.
   */
  ports(widget: Widget) {
    const { options } = this.config(widget);
    const said = options.length ? `one of: ${options.join(', ')}` : '';
    return { inputs: [], outputs: [port(`${widget.id}_out`, widget.label || widget.id, 'output', 'text', false, said)] };
  }

  async execute(widget: Widget) {
    return { [`${widget.id}_out`]: this.config(widget).value };
  }

  // ── Build time ────────────────────────────────────────────────────────────

  override graphAuthorNote(): string {
    return 'options = one per line';
  }
}
