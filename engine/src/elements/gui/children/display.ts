// The base every drawing block shares: an optional transform in front of it.
import { DisplayWidget, type Widget } from '../../../element.ts';
import { logicFrom, Logic } from '../../../logic.ts';
import type { LogicFields } from '../../../logic.ts';

/** The two halves every drawing block keeps, and the one its button writes. */
export const TRANSFORM_FIELDS: LogicFields = { body: 'code', prompt: 'code_prompt', file: 'code_file' };

export interface TransformConfig {
  code: string;
}

/**
 * A display with an optional transform: whatever arrives is reshaped into what
 * this kind of block can draw.
 *
 * Nothing downstream depends on the result, so a failing transform shows its
 * message in the block instead of failing the node — which used to take every
 * sibling block's output down with it.
 */
export abstract class TransformingDisplay extends DisplayWidget<TransformConfig> {
  config(widget: Widget): TransformConfig {
    return {
      code: String(widget.config.code ?? ''),
    };
  }

  override logic(widget: Widget): Logic {
    return logicFrom(widget, 'code', TRANSFORM_FIELDS, 'this transform');
  }
}
