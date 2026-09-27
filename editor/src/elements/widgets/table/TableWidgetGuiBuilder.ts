import type { GuiWidget } from '@/graph';
import { fromEngine, type ElementGeneration } from '@/authoring/generation';
import { TableWidgetRunner } from '@engine/elements/widgets/table/TableWidgetRunner.ts';
import { TransformingDisplayGuiBuilder } from '../TransformingDisplayGuiBuilder';

export class TableWidgetGuiBuilder extends TransformingDisplayGuiBuilder {
  readonly widgetKind = 'table';

  // ── Build time ────────────────────────────────────────────────────────────

  readonly label = 'Table';

  readonly shows = 'Rows: a list of objects sharing their keys -- the keys become the columns, in the order the first row has them -- or a list of lists whose first row is the header. Its code hands them on as {"value": rows}.';

  override readonly generation: ElementGeneration<GuiWidget> = {
    ...fromEngine(new TableWidgetRunner().generation()),
    promptLabel: 'What the table should show',
    promptPlaceholder: 'e.g. one row per file, with its name, size and date',
    bodyLabel: 'Code — run(inputs) receives {"value"} and returns {"value": rows}',
    bodyHeight: 90,
  };
}
