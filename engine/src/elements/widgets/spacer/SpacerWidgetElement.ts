import { StaticWidgetElement } from '../StaticWidgetElement.ts';
import { type Widget } from '../../WidgetElement.ts';
import { type RuleConfig } from '../rule.ts';

/** Air between sections — the block that says one thing ended. */
export class SpacerWidgetElement extends StaticWidgetElement<RuleConfig> {
  readonly widgetKind = 'spacer' as const;
  config(widget: Widget): RuleConfig {
    return { vertical: widget.config.mode === 'vertical' };
  }
}
