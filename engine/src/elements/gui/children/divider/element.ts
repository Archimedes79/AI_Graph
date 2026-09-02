import { StaticWidget, type Widget } from '../../../../element.ts';
import { type RuleConfig } from '../rule.ts';

/** A rule between sections. Holds nothing at all. */
export class DividerElement extends StaticWidget<RuleConfig> {
  readonly widgetKind = 'divider' as const;
  config(widget: Widget): RuleConfig {
    return { vertical: widget.config.mode === 'vertical' };
  }
}
