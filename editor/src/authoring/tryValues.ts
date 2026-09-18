// The values an element is tried on -- and generated against.
//
// One place, because they are one thing. What ▶ Test sends is what ✨ Generate
// should be shown: the sample a model writes code against and the sample that
// code is then run on have to be the same sample, or the verify pass verifies
// something nobody looked at. They used to come from two places -- the last
// run's inputs for ✨, a component's private state for ▶ -- so a value typed to
// try a prompt on was invisible to the generator sitting next to it.
//
// Three sources, in this order: what the person typed, what ⟳ fetched by
// running the graph up to here, what the last run delivered.

import { create } from 'zustand';

interface TryStore {
  /** By subject key (`nodeId`, or `nodeId::blockId`), then by port. */
  typed: Record<string, Record<string, string>>;
  fetched: Record<string, Record<string, unknown>>;
  setTyped: (key: string, port: string, text: string | undefined) => void;
  setFetched: (key: string, values: Record<string, unknown>) => void;
}

export const useTryValues = create<TryStore>((set) => ({
  typed: {},
  fetched: {},
  setTyped: (key, port, text) => set((state) => {
    const own = { ...(state.typed[key] ?? {}) };
    if (text === undefined) delete own[port]; else own[port] = text;
    return { typed: { ...state.typed, [key]: own } };
  }),
  // Fetched values replace typed ones: asking the graph is saying "the real thing, please".
  setFetched: (key, values) => set((state) => ({
    fetched: { ...state.fetched, [key]: values },
    typed: { ...state.typed, [key]: {} },
  })),
}));

/**
 * What someone typed, as the value it stands for.
 *
 * A list or an object is typed as JSON, because that is how one is written
 * down; anything that does not parse as one is the text it is. A bare number
 * stays text on purpose -- "17" typed into a prompt's input is a sentence, and a
 * body that wants a number says `Number()`.
 */
export function typedValue(text: string): unknown {
  const trimmed = text.trim();
  if (!/^[[{]/.test(trimmed)) return text;
  try {
    return JSON.parse(trimmed);
  } catch {
    return text;
  }
}

/** The values to try on, per port, and where each came from. */
export function tryValues(
  key: string,
  ports: string[],
  observed: Record<string, unknown>,
  store: Pick<TryStore, 'typed' | 'fetched'> = useTryValues.getState(),
): { values: Record<string, unknown>; source: Record<string, 'typed' | 'graph' | 'last run'> } {
  const values: Record<string, unknown> = {};
  const source: Record<string, 'typed' | 'graph' | 'last run'> = {};
  for (const port of ports) {
    const typed = store.typed[key]?.[port];
    const fetched = store.fetched[key]?.[port];
    if (typed !== undefined) { values[port] = typedValue(typed); source[port] = 'typed'; }
    else if (fetched !== undefined) { values[port] = fetched; source[port] = 'graph'; }
    else if (observed[port] !== undefined) { values[port] = observed[port]; source[port] = 'last run'; }
  }
  return { values, source };
}

/**
 * The sample a generation is written and verified against: whatever the "try
 * it" panel currently holds -- typed, fetched from the graph, or the last
 * run's. Undefined when it holds nothing, which turns the verify pass off
 * rather than inventing a sample.
 */
export function sampleFor(
  subject: string,
  ports: string[],
  observed: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  const { values } = tryValues(subject, ports, observed ?? {});
  return Object.keys(values).length ? values : undefined;
}
