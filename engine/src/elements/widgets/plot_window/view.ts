/**
 * The room a chart leaves around itself, in screen pixels.
 *
 * This used to be a *coordinate space* as well -- a fixed 400x240 box that
 * everything was drawn inside and then scaled into the block. That made a
 * chart's text a function of the block's size: at 1084x470 the box scaled by
 * 1.38, so an 11px label arrived as 15px and a tenth of the width was dead
 * letterbox. It also contradicted the body contract next door, which tells an
 * author to "lay the chart out for the size you are given".
 *
 * There is one answer now, and it is that one: a chart is drawn at the size the
 * block actually is. What is left here is what was always honestly pixels --
 * the margins -- and even those are a floor, since the room a value axis needs
 * depends on how long its numbers are (`chartMargins`).
 */
export const PLOT_VIEW = {
  margin: { left: 46, right: 14, top: 16, bottom: 30 },
};
