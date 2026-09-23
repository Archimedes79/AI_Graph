// What a node's outputs look like, written down: its output interface.
//
// Interfaces are not designed up front here. Nodes are wired, the graph runs,
// and what actually came out of a node is the first honest statement of its
// interface -- so a run proposes one (`inferInterface`), the person keeps it,
// and from then on it is a contract: every later run is held to it
// (`mismatches`), and the nodes after it are generated against it.
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

/** One schema both *a* and *b* satisfy: what several items of one list have in common. */
export function merge(a: Schema, b: Schema): Schema {
  if (!a.type || !b.type) return {};
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

/** A node's output interface, from what one run produced on its ports. */
export function inferInterface(outputs: Record<string, unknown>): Schema {
  return inferSchema(outputs);
}

/**
 * Where *value* breaks *schema*, as sentences naming the place: `output.rows[3].Population
 * is text, the interface says number`. Empty when it fits. Stops after a few:
 * one broken list of a thousand rows is one problem, not a thousand.
 */
export function mismatches(value: unknown, schema: Schema, at = 'output', found: string[] = []): string[] {
  if (found.length >= 5 || !schema.type) return found;
  const actual = typeOf(value);
  const allowed = [schema.type].flat();
  const fits = allowed.includes(actual) || (actual === 'integer' && allowed.includes('number'));
  if (!fits) {
    // Null where something was expected is a missing value, and said as such.
    found.push(actual === 'null'
      ? `${at} is empty; the interface says ${allowed.join(' or ')}`
      : `${at} is ${actual}; the interface says ${allowed.join(' or ')}`);
    return found;
  }
  if (actual === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of schema.required ?? []) {
      if (record[key] === undefined || record[key] === null) found.push(`${at}.${key} is missing`);
    }
    for (const [key, property] of Object.entries(schema.properties ?? {})) {
      if (record[key] !== undefined && record[key] !== null) mismatches(record[key], property, `${at}.${key}`, found);
    }
  }
  if (actual === 'array' && schema.items) {
    (value as unknown[]).slice(0, 200).forEach((item, index) => {
      if (item !== null && item !== undefined) mismatches(item, schema.items!, `${at}[${index}]`, found);
    });
  }
  return found.slice(0, 5);
}

/** A stored interface: an object, or the JSON text of one. Anything else is no interface. */
export function readInterface(stored: unknown): Schema | undefined {
  let value = stored;
  if (typeof value === 'string') {
    if (!value.trim()) return undefined;
    try {
      value = JSON.parse(value);
    } catch {
      return undefined;
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Schema : undefined;
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
