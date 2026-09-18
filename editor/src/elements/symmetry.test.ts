/**
 * The engine and the editor describe the same elements: file for file, name
 * for name, and class hierarchy for class hierarchy.
 *
 * Every element is a folder at the same relative path on both sides, and its
 * two halves are a pair of classes -- `Element` on the engine side, `Ui` on the
 * editor side -- whose inheritance mirrors, level for level:
 *
 *   PlotWindowWidgetElement → TransformingDisplayElement → DisplayWidgetElement → WidgetElement → Element
 *   PlotWindowWidgetUi      → TransformingDisplayUi      → DisplayWidgetUi      → WidgetUi      → Ui
 *
 * and the two registries list the same kinds. A new element with only one
 * half -- or a half filed, named or derived some other way -- is a failure
 * here rather than a blank panel or a missing widget on someone's page.
 */
import { describe, expect, it } from 'vitest';
import { registry } from '@engine/elements/registry.ts';
import { NODE_UIS, WIDGET_UIS } from './registry';

const ENGINE = Object.keys(import.meta.glob('../../../engine/src/elements/{nodes,widgets}/*/*.ts'))
  .map((path) => path.replace('../../../engine/src/elements/', ''));
const EDITOR = Object.keys(import.meta.glob('./{nodes,widgets}/*/*.{ts,tsx}'))
  .map((path) => path.replace('./', ''));
/** Every editor half, as its module exports it -- loaded one by one, in no order the registry chose. */
const UI_MODULES = import.meta.glob('./{nodes,widgets}/*/*Ui.ts', { eager: true }) as Record<string, Record<string, unknown>>;

const pascal = (kind: string) => kind.split('_').map((word) => word[0].toUpperCase() + word.slice(1)).join('');

/** An object's class and every class above it, most specific first. */
function lineage(instance: object): string[] {
  const names: string[] = [];
  for (let proto = Object.getPrototypeOf(instance); proto && proto !== Object.prototype; proto = Object.getPrototypeOf(proto)) {
    names.push(proto.constructor.name);
  }
  return names;
}

const mirrored = (engineLineage: string[]) => engineLineage.map((name) => name.replace(/Element$/, 'Ui'));

describe('the two halves of every element', () => {
  it('are registered for the same node types and widget kinds', () => {
    expect(Object.keys(NODE_UIS).sort()).toEqual([...registry.nodeTypes()].sort());
    expect(Object.keys(WIDGET_UIS).sort()).toEqual([...registry.widgetKinds()].sort());
  });

  it.each([...registry.nodeTypes()])('node %s: <Kind>NodeElement in the engine, <Kind>NodeUi in the editor', (kind) => {
    const name = `${pascal(kind)}Node`;
    const element = registry.node(kind)!;
    const ui = NODE_UIS[kind as keyof typeof NODE_UIS];
    expect(ENGINE).toContain(`nodes/${kind}/${name}Element.ts`);
    expect(UI_MODULES[`./nodes/${kind}/${name}Ui.ts`]?.[`${name}Ui`]).toBe(ui.constructor);
    expect(lineage(ui)).toEqual(mirrored(lineage(element)));
  });

  it.each([...registry.widgetKinds()])('widget %s: <Kind>WidgetElement, <Kind>WidgetUi and <Kind>WidgetView', (kind) => {
    const name = `${pascal(kind)}Widget`;
    const element = registry.widget(kind)!;
    const ui = WIDGET_UIS[kind as keyof typeof WIDGET_UIS];
    expect(ENGINE).toContain(`widgets/${kind}/${name}Element.ts`);
    expect(UI_MODULES[`./widgets/${kind}/${name}Ui.ts`]?.[`${name}Ui`]).toBe(ui.constructor);
    expect(EDITOR).toContain(`widgets/${kind}/${name}View.tsx`);
    expect(lineage(ui)).toEqual(mirrored(lineage(element)));
  });

  it('has no element folder on one side only', () => {
    const folders = (paths: string[]) => new Set(paths.map((path) => path.split('/').slice(0, 2).join('/')));
    expect([...folders(EDITOR)].sort()).toEqual([...folders(ENGINE)].sort());
  });
});
