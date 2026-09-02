import { StaticWidget, type Widget } from '../../../../element.ts';
import { type RuleConfig } from '../rule.ts';

/** Air between sections — the block that says one thing ended. */
export class SpacerElement extends StaticWidget<RuleConfig> {
  readonly widgetKind = 'spacer' as const;
  config(widget: Widget): RuleConfig {
    return { vertical: widget.config.mode === 'vertical' };
  }
}
