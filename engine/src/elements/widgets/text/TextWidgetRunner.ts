import { StaticWidgetRunner } from '../StaticWidgetRunner.ts';
import { type Widget } from '../../WidgetRunner.ts';
import { textRole, type TextRole } from './role.ts';

export interface TextConfig {
  text: string;
  role: TextRole;
}

/** A heading, a paragraph or a caption: one block, three formattings. */
export class TextWidgetRunner extends StaticWidgetRunner<TextConfig> {
  readonly widgetKind = 'text' as const;

  config(widget: Widget): TextConfig {
    return {
      text: String(widget.config.value ?? ''),
      role: textRole(widget.config.mode),
    };
  }
}
