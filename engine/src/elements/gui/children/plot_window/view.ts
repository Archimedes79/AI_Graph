/**
 * The space a chart is drawn in, and the frame left free inside it.
 *
 * Declared here, in the element, because two parties have to agree on it: the
 * app when it draws points itself, and the model when it draws its own SVG. A
 * block is resizable, so neither may think in screen pixels -- everything is
 * in these coordinates, and the box scales them. The model was told to draw
 * its own axes but not that a margin had to be left for them, so its labels
 * ran off the edge of whatever size the block happened to be.
 */
export const PLOT_VIEW = {
  width: 400,
  height: 240,
  margin: { left: 46, right: 14, top: 16, bottom: 30 },
};
