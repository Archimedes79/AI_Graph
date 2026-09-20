import { StaticWidgetRunner } from '../StaticWidgetRunner.ts';
import { type Widget } from '../../WidgetRunner.ts';
import { type RuleConfig } from '../rule.ts';

/** Air between sections — the block that says one thing ended. */
export class SpacerWidgetRunner extends StaticWidgetRunner<RuleConfig> {
  readonly widgetKind = 'spacer' as const;

  config(widget: Widget): RuleConfig {
    return { vertical: widget.config.mode === 'vertical' };
  }
}
