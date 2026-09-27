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

/**
 * What this keeps in files of its own in a project folder: see `ElementRunner.texts`.
 *
 * `example` is the one example input the block is written and tried against
 * in the editor -- `{"value": …}`, as the transform is handed it -- kept as
 * it was typed. A run never reads it.
 */
const TRANSFORM_TEXTS: readonly TextFile[] = [
  { field: 'code', file: 'code.js' },
  { field: 'code_prompt', file: 'task.md' },
  { field: 'example', file: 'example.json' },
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

  // ── Build time ────────────────────────────────────────────────────────────

  /**
   * What this kind draws as it arrives -- unless the block has code of its
   * own, which takes whatever it was written to read and shapes it itself.
   * Told the kind's shape regardless, the node upstream was generated to
   * pre-shape rows into points that the block's own code then read as rows.
   *
   * Once, here: each of the three kinds carried the same test for its code
   * in front of its own sentence. A block handed over without its settings
   * (`config`) counts as one without code.
   */
  override receives(widget: Widget): string | undefined {
    return String(widget.config?.code ?? '').trim() ? undefined : this.receivesAsItIs();
  }

  /** What a node wired into this kind of block should hand it, while the block has no code of its own. */
  protected abstract receivesAsItIs(): string;
}
