import type { Edge } from 'reactflow';
import { RUN_PORT } from '@engine/execution/triggers.ts';
import { ACCENT, DIMMER, EVENT } from '@/ui/theme';

/**
 * How a wire is drawn: a soft grey line, so the cards are what the eye finds
 * first -- and in the accent where it touches a node that is selected, or is
 * itself selected and about to be deleted, so what a node is wired to shows
 * the moment it is chosen.
 *
 * A wire into a ◆ only says "start here" and delivers nothing, so it stays
 * dashed and amber whatever is selected: a canvas where it looked like data
 * invited the question of what the AI node does with a button's `true`.
 */
export function drawnWire(edge: Edge, selected: ReadonlySet<string>): Edge {
  const lit = !!edge.selected || selected.has(edge.source) || selected.has(edge.target);
  const signal = edge.targetHandle === RUN_PORT;
  return {
    ...edge,
    // Over the grey ones, where they cross.
    zIndex: lit ? 1 : 0,
    style: {
      stroke: signal ? EVENT : lit ? ACCENT : DIMMER,
      strokeWidth: lit ? 2.5 : 2,
      ...(signal ? { strokeDasharray: '6 4' } : {}),
    },
  };
}
