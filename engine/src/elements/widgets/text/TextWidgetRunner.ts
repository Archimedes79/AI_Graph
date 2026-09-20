import { StaticWidgetRunner } from '../StaticWidgetRunner.ts';
import { type Widget } from '../../WidgetRunner.ts';

export type TextRole = 'heading' | 'body' | 'caption';

export interface TextConfig {
  text: string;
  role: TextRole;
}

/** A heading, a paragraph or a caption: one block, three formattings. */
export class TextWidgetRunner extends StaticWidgetRunner<TextConfig> {
  readonly widgetKind = 'text' as const;

  config(widget: Widget): TextConfig {
    const role = String(widget.config.mode ?? 'body');
    return {
      text: String(widget.config.value ?? ''),
      role: (['heading', 'body', 'caption'].includes(role) ? role : 'body') as TextRole,
    };
  }
}
