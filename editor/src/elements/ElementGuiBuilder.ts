// The half of an element that exists so a person can build with it.
//
// The mirror of `engine/src/elements/ElementRunner.ts`, class for class: every
// element class there ends in `Runner`, and its counterpart here swaps that for
// `GuiBuilder` -- `ElementRunner` / `ElementGuiBuilder`, `NodeRunner` /
// `NodeGuiBuilder`, `AiNodeRunner` / `AiNodeGuiBuilder` -- in the same folder,
// under the same name.
//
// **The name is the whole point.** Two axes cross here. `Runner` against
// `GuiBuilder` is *what the class is for*: running the application, or building
// it. `Gui` in the middle is *where it lives*: the engine holds the graph and
// runs it, and everything a person clicks is in the browser, which the engine
// never imports. So a builder is the browser's build-time half, and it is the
// only one of the three roles that a delivered tool must not contain -- see
// `page/blocks.ts` for the third, which is neither.
//
// What a builder adds to its element is the editor's part: its panel (the
// settings), and what the editor's shells ask of it, so no shell switches on a
// type name. A panel is registered with `lazy(() => import(…))`: its own chunk,
// loaded when the element is opened in the editor and never by a deployed tool.

import type { ComponentType } from 'react';
import type { ElementGeneration } from '@/authoring/generation';

/** `Subject` is what the element is attached to (a node, a widget); `PanelProps` what its panel is handed. */
export abstract class ElementGuiBuilder<Subject, PanelProps> {
  /** The element's settings panel. Absent for an element with nothing to set: a rule, a gap. */
  readonly Panel?: ComponentType<PanelProps>;

  /**
   * The ✨ Generate button this element offers, mirroring the engine's
   * `ElementRunner.generation()`. Absent for an element that authors nothing, which
   * is what decides whether a button is drawn at all.
   */
  readonly generation?: ElementGeneration<Subject>;
}
