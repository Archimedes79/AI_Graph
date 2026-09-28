// What a node's outputs look like, written down: its output interface.
//
// A node that has an output definition (its `output.js`) is held to the
// shape of that definition's example: `inferInterface` reads the shape off
// the example, every run is checked against it (`mismatches`), and a wire
// from it into a port that takes something else is found before anything runs.
//
// JSON Schema, and only the part of it that plain JSON values need: types,
// properties, required keys and list items. Enough to say "rows is a list of
// objects with a numeric Population", which is what goes wrong between two
// nodes; not a validator for everything the standard can express.

/** A JSON Schema, as far as this module writes and reads one. */
export interface Schema {
  type?: string | string[];
  properties?: Record<string, Schema>;
  required?: string[];
  items?: Schema;
  description?: string;
}

/** Past this depth a value is described as "anything": an interface, not a copy of the data. */
const DEPTH = 6;
/** How many items of a list are looked at to describe one. */
const SAMPLED = 25;

function typeOf(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return typeof value;
}

/** The schema one value satisfies. */
export function inferSchema(value: unknown, depth = 0): Schema {
  // Null says nothing about what the port carries the rest of the time.
  if (value === null || value === undefined || depth > DEPTH) return {};
  const type = typeOf(value);
  if (type === 'array') {
    const items = (value as unknown[]).slice(0, SAMPLED).map((item) => inferSchema(item, depth + 1));
    return items.length ? { type, items: items.reduce(merge) } : { type };
  }
  if (type === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    return {
      type,
      properties: Object.fromEntries(entries.map(([key, item]) => [key, inferSchema(item, depth + 1)])),
      required: entries.filter(([, item]) => item !== null && item !== undefined).map(([key]) => key),
    };
  }
  return { type };
}

/**
 * One schema both *a* and *b* satisfy: what several items of one list have in
 * common. A side that says nothing -- a null, one row's missing value -- leaves
 * the other side's word standing: one empty cell in a column of numbers does
 * not make the column "anything".
 */
export function merge(a: Schema, b: Schema): Schema {
  if (!a.type) return b;
  if (!b.type) return a;
  if (JSON.stringify(a) === JSON.stringify(b)) return a;
  const types = new Set([...[a.type].flat(), ...[b.type].flat()]);
  if (types.has('integer') && types.has('number')) types.delete('integer');
  if (types.size > 1) return { type: [...types].sort() };
  const [type] = types;
  if (type === 'object') {
    const keys = new Set([...Object.keys(a.properties ?? {}), ...Object.keys(b.properties ?? {})]);
    return {
      type,
      properties: Object.fromEntries([...keys].map((key) => {
        const left = a.properties?.[key];
        const right = b.properties?.[key];
        return [key, left && right ? merge(left, right) : left ?? right ?? {}];
      })),
      // Required only where every item had it.
      required: (a.required ?? []).filter((key) => (b.required ?? []).includes(key)),
    };
  }
  if (type === 'array') {
    if (!a.items || !b.items) return { type };
    return { type, items: merge(a.items, b.items) };
  }
  return { type };
}

/** A node's output interface, from what one call produced on its ports. */
export function inferInterface(outputs: Record<string, unknown>): Schema {
  return inferSchema(outputs);
}

/**
 * What a node run once per item hands on, from what one call returns
 * (*schema*): on each output port in *collected* -- the ones declared lists --
 * the list the executor collects the calls' answers into, a list one call
 * returns flattened into it (`mergeBatchOutputs`). The other ports as they are.
 */
export function collectedInterface(schema: Schema, collected: Set<string>): Schema {
  if (!schema.properties) return schema;
  return {
    ...schema,
    properties: Object.fromEntries(Object.entries(schema.properties).map(([port, one]) => [
      port,
      !collected.has(port) || [one.type].flat().includes('array') ? one : { type: 'array', ...(one.type ? { items: one } : {}) },
    ])),
  };
}

/** A JSON type as a sentence says it. */
const TYPE_WORDS: Record<string, string> = {
  string: 'text', integer: 'a number', number: 'a number', boolean: 'true or false', array: 'a list', object: 'an object', null: 'empty',
};

/** Types in words, each once -- an integer is "a number" too, unless *whole* asks to tell the two apart. */
function typeWords(types: string[], whole = false): string {
  return [...new Set(types.map((type) => (whole && type === 'integer' ? 'a whole number' : TYPE_WORDS[type] ?? type)))].join(' or ');
}

/**
 * Where in what one call returned, as a person reads it: the output, named
 * once, and the place inside it -- `output "rows" at [3].Population`. *path*
 * is the keys and list positions down to it; none, for the whole of it.
 */
function placeOf(path: string[]): string {
  if (!path.length) return 'what it returned';
  const [port, ...inside] = path;
  const rest = inside.map((part, at) => (part.startsWith('[') || at === 0 ? part : `.${part}`)).join('');
  return `output "${port}"${rest ? ` at ${rest}` : ''}`;
}

/**
 * Where *value* breaks *schema*, as sentences naming the place: `output "rows"
 * at [3].Population is text; output.js says a number`. Empty when it fits.
 * Stops after a few: one broken list of a thousand rows is one problem, not a
 * thousand.
 */
export function mismatches(value: unknown, schema: Schema, path: string[] = [], found: string[] = []): string[] {
  if (found.length >= 5 || !schema.type) return found;
  const actual = typeOf(value);
  const allowed = [schema.type].flat();
  const fits = allowed.includes(actual) || (actual === 'integer' && allowed.includes('number'));
  if (!fits) {
    const place = placeOf(path);
    // Null where something was expected is a missing value, and said as such;
    // a fraction where only whole numbers were is the one case "a number" does not tell.
    found.push(actual === 'null' ? `${place} is empty; output.js says ${typeWords(allowed)}`
      : actual === 'number' && allowed.includes('integer') ? `${place} is a number with a fraction; output.js says ${typeWords(allowed, true)}`
        : `${place} is ${typeWords([actual])}; output.js says ${typeWords(allowed)}`);
    return found;
  }
  if (actual === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of schema.required ?? []) {
      if (record[key] === undefined || record[key] === null) found.push(`${placeOf([...path, key])} is missing`);
    }
    for (const [key, property] of Object.entries(schema.properties ?? {})) {
      if (record[key] !== undefined && record[key] !== null) mismatches(record[key], property, [...path, key], found);
    }
  }
  if (actual === 'array' && schema.items) {
    (value as unknown[]).slice(0, 200).forEach((item, index) => {
      if (item !== null && item !== undefined) mismatches(item, schema.items!, [...path, `[${index}]`], found);
    });
  }
  return found.slice(0, 5);
}

/** The JSON types a port of each declared type takes. Absent: it takes anything (text, json, any, binary). */
const TAKES: Partial<Record<string, string[]>> = {
  number: ['number', 'integer'],
  boolean: ['boolean'],
  list: ['array'],
  file_path: ['string'],
  image: ['string'],
};

/**
 * Why what *schema* describes cannot go into a port declared as *dataType*, or
 * '' when it can -- or when either side says too little to tell.
 *
 * A list into a port that is not itself a list is judged by its items: that is
 * a port collecting several values, or a node running once per item.
 */
export function portMisfit(schema: Schema, dataType: string, multi: boolean): string {
  const takes = TAKES[dataType];
  if (!takes || !schema.type) return '';
  let given = [schema.type].flat().filter((type) => type !== 'null');
  if (given.includes('array') && dataType !== 'list') {
    if (!multi && given.length > 1) return '';
    const items = schema.items;
    if (!items?.type) return '';
    given = [items.type].flat().filter((type) => type !== 'null');
  }
  if (!given.length || given.some((type) => takes.includes(type))) return '';
  return `it gives ${given.join(' or ')}, and the port takes ${dataType}`;
}

/** A schema as a one-line outline -- `{ rows: list of { File: text } }` -- for reading, not checking. */
export function schemaOutline(schema: unknown, depth = 0): string {
  if (!schema || typeof schema !== 'object' || depth > 4) return 'anything';
  const part = schema as { type?: string | string[]; items?: unknown; properties?: Record<string, unknown> };
  const type = Array.isArray(part.type) ? part.type.join(' or ') : part.type;
  if (type === 'array') return `list of ${schemaOutline(part.items, depth + 1)}`;
  if (part.properties && typeof part.properties === 'object') {
    return `{ ${Object.entries(part.properties).map(([key, value]) => `${key}: ${schemaOutline(value, depth + 1)}`).join(', ')} }`;
  }
  const words: Record<string, string> = { string: 'text', integer: 'whole number', number: 'number', boolean: 'yes/no', null: 'nothing' };
  return (type && words[type]) ?? type ?? 'anything';
}
