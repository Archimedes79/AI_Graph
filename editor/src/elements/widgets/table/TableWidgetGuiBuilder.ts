import type { GuiWidget } from '@/graph';
import { fromEngine, type ElementGeneration } from '@/authoring/generation';
import { TableWidgetRunner } from '@engine/elements/widgets/table/TableWidgetRunner.ts';
import { TransformingDisplayGuiBuilder } from '../TransformingDisplayGuiBuilder';

export class TableWidgetGuiBuilder extends TransformingDisplayGuiBuilder {
  readonly widgetKind = 'table';

  // ── Build time ────────────────────────────────────────────────────────────

  readonly label = 'Table';

  readonly transformTitle = 'Row transform (optional)';

  readonly transformHelp = 'The code must return {"value": <rows>} — a list of objects sharing their keys (the keys become the columns), or a list of lists whose first row is the header. Leave empty to show the incoming value as-is.';

  override readonly generation: ElementGeneration<GuiWidget> = {
    ...fromEngine(new TableWidgetRunner().generation()),
    promptLabel: 'Prompt',
    promptPlaceholder: 'Describe the rows you want, e.g. one row per file with name, size and date.',
    bodyLabel: 'Optional transform — run(inputs) receives {"value"} and returns {"value"}',
    mono: true,
    bodyPlaceholder: 'Leave empty to show the incoming rows as-is.',
    bodyHeight: 90,
  };
}
