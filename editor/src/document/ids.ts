// The id something new is given: what it is, and a number only when that is taken.
//
// An id never changes -- wires, folders and ports are named after it -- so it
// is what a person reads in `flow.json` for as long as the thing exists. The
// type of a node or the kind of a block says more there than a counter and a
// timestamp did (`code-2-1790190787690`), and a label, which is changed at
// will, would say something that stops being true.

/** `code`, then `code_2`, `code_3`: the first of these not in *taken*. */
export function freeId(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; ; n += 1) {
    if (!used.has(`${base}_${n}`)) return `${base}_${n}`;
  }
}
