// The base every drawing block shares: an optional transform in front of it.
import { DisplayWidgetRunner } from './DisplayWidgetRunner.ts';
import { type Widget } from '../WidgetRunner.ts';
import { logicFrom, Logic } from '../../authoring/logic.ts';
import type { LogicFields } from '../../authoring/logic.ts';
import type { TextFile } from '../ElementRunner.ts';

/** The two halves every drawing block keeps, and the one its button writes. */
export const TRANSFORM_FIELDS: LogicFields = { body: 'code', prompt: 'code_prompt' };

export interface TransformConfig {
  code: string;
}

/** What this keeps in files of its own in a project folder: see `ElementRunner.texts`. */
const TRANSFORM_TEXTS: readonly TextFile[] = [
  { field: 'code', file: 'code.js' },
  { field: 'code_prompt', file: 'task.md' },
];

/**
 * A display with an optional transform: whatever arrives is reshaped into what
 * this kind of block can draw.
 *
 * Nothing downstream depends on the result, so a failing transform shows its
 * message in the block instead of failing the node — which used to take every
 * sibling block's output down with it.
 */
export abstract class TransformingDisplayRunner extends DisplayWidgetRunner<TransformConfig> {
  override texts(): readonly TextFile[] {
    return TRANSFORM_TEXTS;
  }

  config(widget: Widget): TransformConfig {
    return {
      code: String(widget.config.code ?? ''),
    };
  }

  override logic(widget: Widget): Logic {
    return logicFrom(widget, 'code', TRANSFORM_FIELDS);
  }
}
