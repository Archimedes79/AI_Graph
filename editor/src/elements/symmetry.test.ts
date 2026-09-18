/**
 * The engine and the editor describe the same elements, file for file.
 *
 * Every element is a folder at the same relative path on both sides:
 *
 *   engine/src/elements/nodes/<kind>/<Kind>Node.ts      what it is and does
 *   editor/src/elements/nodes/<kind>/<Kind>Node.ui.ts   how it is edited
 *   engine/src/elements/widgets/<kind>/<Kind>Widget.ts  what it is and does
 *   editor/src/elements/widgets/<kind>/<Kind>Widget.ui.ts, <Kind>WidgetView.tsx
 *
 * and the two registries list the same kinds. A new element with only one half
 * -- or a half filed somewhere else -- is a failure here rather than a blank
 * panel or a missing block on someone's page.
 */
import { describe, expect, it } from 'vitest';
import { registry } from '@engine/elements/registry.ts';
import { NODE_UIS, WIDGET_UIS } from './registry';

const ENGINE = Object.keys(import.meta.glob('../../../engine/src/elements/{nodes,widgets}/*/*.ts'))
  .map((path) => path.replace('../../../engine/src/elements/', ''));
const EDITOR = Object.keys(import.meta.glob('./{nodes,widgets}/*/*.{ts,tsx}'))
  .map((path) => path.replace('./', ''));

const pascal = (kind: string) => kind.split('_').map((word) => word[0].toUpperCase() + word.slice(1)).join('');

describe('the two halves of every element', () => {
  it('are registered for the same node types and widget kinds', () => {
    expect(Object.keys(NODE_UIS).sort()).toEqual([...registry.nodeTypes()].sort());
    expect(Object.keys(WIDGET_UIS).sort()).toEqual([...registry.widgetKinds()].sort());
  });

  it.each([...registry.nodeTypes()])('node %s: <Kind>Node.ts in the engine, <Kind>Node.ui.ts in the editor', (kind) => {
    const name = `${pascal(kind)}Node`;
    expect(ENGINE).toContain(`nodes/${kind}/${name}.ts`);
    expect(EDITOR).toContain(`nodes/${kind}/${name}.ui.ts`);
    expect(registry.node(kind)?.constructor.name).toBe(name);
  });

  it.each([...registry.widgetKinds()])('widget %s: <Kind>Widget.ts, <Kind>Widget.ui.ts and <Kind>WidgetView.tsx', (kind) => {
    const name = `${pascal(kind)}Widget`;
    expect(ENGINE).toContain(`widgets/${kind}/${name}.ts`);
    expect(EDITOR).toContain(`widgets/${kind}/${name}.ui.ts`);
    expect(EDITOR).toContain(`widgets/${kind}/${name}View.tsx`);
    expect(registry.widget(kind)?.constructor.name).toBe(name);
  });

  it('has no element folder on one side only', () => {
    const folders = (paths: string[]) => new Set(paths.map((path) => path.split('/').slice(0, 2).join('/')));
    expect([...folders(EDITOR)].sort()).toEqual([...folders(ENGINE)].sort());
  });
});
