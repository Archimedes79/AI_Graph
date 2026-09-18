import { StaticWidgetElement } from '../StaticWidgetElement.ts';
import { type Widget } from '../../WidgetElement.ts';
import { type RuleConfig } from '../rule.ts';

/** A rule between sections. Holds nothing at all. */
export class DividerWidgetElement extends StaticWidgetElement<RuleConfig> {
  readonly widgetKind = 'divider' as const;
  config(widget: Widget): RuleConfig {
    return { vertical: widget.config.mode === 'vertical' };
  }
}
