import type { ExecutionStatus } from '../types/graph';

/**
 * Whether a node result carries usable output.
 *
 * `partial` means a per-item batch had some items fail and the rest succeed: the
 * outputs are real, with `null` at the failed positions so the batch stays
 * index-aligned with its input. Everywhere that used to ask `status ===
 * 'success'` before reading `outputs` has to accept it too, or one bad item in a
 * thousand hides the other 999 from the panel, the canvas and memory
 * persistence alike.
 */
export const delivered = (status: ExecutionStatus | string | undefined): boolean =>
  status === 'success' || status === 'partial';

/** Chip/label colours for a status, shared by the results panel and the canvas. */
export const statusTone = (status: ExecutionStatus | string | undefined) => {
  if (status === 'success') return { bg: 'rgba(34,197,94,0.1)', fg: '#86efac' };
  if (status === 'partial') return { bg: 'rgba(234,179,8,0.12)', fg: '#fcd34d' };
  return { bg: 'rgba(239,68,68,0.1)', fg: '#fca5a5' };
};
