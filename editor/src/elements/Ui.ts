// The browser half of an element: how it looks and how it is edited.
//
// The mirror of `engine/src/elements/Element.ts`, class for class: every
// element class there ends in `Element`, and its counterpart here swaps that
// for `Ui` -- `Element` / `Ui`, `NodeElement` / `NodeUi`, `AiNodeElement` /
// `AiNodeUi` -- in the same folder, under the same name.
//
// What a Ui adds to its element is the browser's part: its panel (the settings,
// in the editor only), its view (how a widget looks on a page), and what the
// editor's shells ask of it, so no shell switches on a type name. A panel is
// registered with `lazy(() => import(…))`: its own chunk, loaded when the
// element is opened in the editor and never by a deployed tool.

import type { ComponentType } from 'react';
import type { ElementGeneration } from '@/authoring/generation';

/** `Subject` is what the element is attached to (a node, a widget); `PanelProps` what its panel is handed. */
export abstract class Ui<Subject, PanelProps> {
  /** The element's settings panel. Absent for an element with nothing to set: a rule, a gap. */
  readonly Panel?: ComponentType<PanelProps>;

  /**
   * The ✨ Generate button this element offers, mirroring the engine's
   * `Element.generation()`. Absent for an element that authors nothing, which
   * is what decides whether a button is drawn at all.
   */
  readonly generation?: ElementGeneration<Subject>;
}
