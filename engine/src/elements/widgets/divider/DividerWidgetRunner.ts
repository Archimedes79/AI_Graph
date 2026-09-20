import { StaticWidgetRunner } from '../StaticWidgetRunner.ts';
import { type Widget } from '../../WidgetRunner.ts';
import { type RuleConfig } from '../rule.ts';

/** A rule between sections. Holds nothing at all. */
export class DividerWidgetRunner extends StaticWidgetRunner<RuleConfig> {
  readonly widgetKind = 'divider' as const;

  config(widget: Widget): RuleConfig {
    return { vertical: widget.config.mode === 'vertical' };
  }
}
