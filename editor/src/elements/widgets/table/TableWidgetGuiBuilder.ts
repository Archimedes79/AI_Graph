import type { GuiWidget } from '@/graph';
import { fromEngine, type ElementGeneration } from '@/authoring/generation';
import { TableWidgetRunner } from '@engine/elements/widgets/table/TableWidgetRunner.ts';
import { TransformingDisplayGuiBuilder } from '../TransformingDisplayGuiBuilder';

export class TableWidgetGuiBuilder extends TransformingDisplayGuiBuilder {
  readonly widgetKind = 'table';

  // ── Build time ────────────────────────────────────────────────────────────

  readonly label = 'Table';

  paletteEntries() {
    return [{ label: this.label, icon: '▦', also: 'rows grid data' }];
  }

  readonly runner = new TableWidgetRunner();

  readonly shows = this.drawsAnd('Its code hands them on as {"value": rows}.');

  override readonly generation: ElementGeneration<GuiWidget> = {
    ...fromEngine(this.runner.generation()),
    promptLabel: 'What the table should show',
    promptPlaceholder: 'e.g. one row per file, with its name, size and date',
    bodyLabel: 'Code — run(inputs) receives {"value"} and returns {"value": rows}',
    bodyHeight: 90,
  };
}
