/**
 * The engine and the editor describe the same elements, file for file and name for name.
 *
 * Every element is a folder at the same relative path on both sides, and its
 * two halves are named as a pair -- `Element` on the engine side, `Ui` on the
 * editor side:
 *
 *   engine/src/elements/nodes/<kind>/<Kind>NodeElement.ts      class <Kind>NodeElement
 *   editor/src/elements/nodes/<kind>/<Kind>NodeUi.ts           const <kind>NodeUi
 *   engine/src/elements/widgets/<kind>/<Kind>WidgetElement.ts  class <Kind>WidgetElement
 *   editor/src/elements/widgets/<kind>/<Kind>WidgetUi.ts       const <kind>WidgetUi
 *                                     and <Kind>WidgetView.tsx
 *
 * and the two registries list the same kinds. A new element with only one half
 * -- or a half filed or named some other way -- is a failure here rather than a
 * blank panel or a missing widget on someone's page.
 */
import { describe, expect, it } from 'vitest';
import { registry } from '@engine/elements/registry.ts';
import { NODE_UIS, WIDGET_UIS } from './registry';

const ENGINE = Object.keys(import.meta.glob('../../../engine/src/elements/{nodes,widgets}/*/*.ts'))
  .map((path) => path.replace('../../../engine/src/elements/', ''));
const EDITOR = Object.keys(import.meta.glob('./{nodes,widgets}/*/*.{ts,tsx}'))
  .map((path) => path.replace('./', ''));
/** Every editor half, as its module exports it. */
const UI_MODULES = import.meta.glob('./{nodes,widgets}/*/*Ui.ts', { eager: true }) as Record<string, Record<string, unknown>>;

const pascal = (kind: string) => kind.split('_').map((word) => word[0].toUpperCase() + word.slice(1)).join('');
const camel = (name: string) => name[0].toLowerCase() + name.slice(1);

describe('the two halves of every element', () => {
  it('are registered for the same node types and widget kinds', () => {
    expect(Object.keys(NODE_UIS).sort()).toEqual([...registry.nodeTypes()].sort());
    expect(Object.keys(WIDGET_UIS).sort()).toEqual([...registry.widgetKinds()].sort());
  });

  it.each([...registry.nodeTypes()])('node %s: <Kind>NodeElement in the engine, <kind>NodeUi in the editor', (kind) => {
    const name = `${pascal(kind)}Node`;
    expect(ENGINE).toContain(`nodes/${kind}/${name}Element.ts`);
    expect(registry.node(kind)?.constructor.name).toBe(`${name}Element`);
    expect(UI_MODULES[`./nodes/${kind}/${name}Ui.ts`]?.[`${camel(name)}Ui`]).toBe(NODE_UIS[kind as keyof typeof NODE_UIS]);
  });

  it.each([...registry.widgetKinds()])('widget %s: <Kind>WidgetElement, <kind>WidgetUi and <Kind>WidgetView', (kind) => {
    const name = `${pascal(kind)}Widget`;
    expect(ENGINE).toContain(`widgets/${kind}/${name}Element.ts`);
    expect(registry.widget(kind)?.constructor.name).toBe(`${name}Element`);
    expect(UI_MODULES[`./widgets/${kind}/${name}Ui.ts`]?.[`${camel(name)}Ui`]).toBe(WIDGET_UIS[kind as keyof typeof WIDGET_UIS]);
    expect(EDITOR).toContain(`widgets/${kind}/${name}View.tsx`);
  });

  it('has no element folder on one side only', () => {
    const folders = (paths: string[]) => new Set(paths.map((path) => path.split('/').slice(0, 2).join('/')));
    expect([...folders(EDITOR)].sort()).toEqual([...folders(ENGINE)].sort());
  });
});
