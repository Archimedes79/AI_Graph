// Reading a graph written by an earlier AI-Graph.
//
// The DSL has retired things: node types that were one behaviour registered
// twice (`widget`), aliases that became a mode (`text_input` → `input` in text
// mode), two node types that were three lines of code each (`merge`, `split`),
// config keys that were renamed into the shared vocabulary, and a placed
// 12-column layout that became a document flow. A file that still says any of
// those must open — in the editor, in the CLI, and in a bundle handed to
// someone who never heard of the rename — so this runs wherever a graph is
// parsed, once, before anything looks at it.
//
// One-time and additive: an already-current graph passes through untouched, so
// this costs nothing on the common path and there is no version number to keep.

type Raw = Record<string, unknown>;

const isRecord = (value: unknown): value is Raw => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

// --- retired node types ----------------------------------------------------

/** legacy input node type -> input_mode; these nodes always prompted at runtime. */
const LEGACY_INPUT_MODES: Record<string, string> = {
  text_input: 'text', file_input: 'file', directory_input: 'directory',
};

function migrateAliasNode(node: Raw): Raw {
  const type = String(node.node_type);
  const config: Raw = { ...(isRecord(node.config) ? node.config : {}) };
  if (type in LEGACY_INPUT_MODES) {
    config.input_mode = LEGACY_INPUT_MODES[type];
    config.prompt_at_runtime = true;
    return { ...node, node_type: 'input', config };
  }
  if (type === 'text_output') {
    config.write_mode = 'window';
    return { ...node, node_type: 'output', config };
  }
  // `widget` was a gui node holding exactly one block, served by the same
  // element registered twice.
  if (type === 'widget') return { ...node, node_type: 'gui' };
  return node;
}

/** Literal `run(inputs)` equivalent to the deleted merge element, per mode. */
function mergeCode(mode: string, separator: string): string {
  const flatten = [
    'function run(inputs) {',
    '  const flat = [];',
    '  for (const value of Object.values(inputs)) {',
    '    if (Array.isArray(value)) flat.push(...value.filter((v) => v !== null && v !== undefined));',
    '    else if (value !== null && value !== undefined) flat.push(value);',
    '  }',
  ].join('\n');
  if (mode === 'sum') return `${flatten}\n  const total = flat.reduce((sum, v) => sum + Number(v), 0);\n  return { output: total };\n}\n`;
  if (mode === 'count') return `${flatten}\n  return { output: flat.length };\n}\n`;
  if (mode === 'json_list') return `${flatten}\n  return { output: JSON.stringify(flat) };\n}\n`;
  // concat, and the fallback for an unrecognised mode, as the element itself had.
  return `${flatten}\n  return { output: flat.map(String).join(${JSON.stringify(separator)}) };\n}\n`;
}

function splitCode(separator: string): string {
  return [
    'function run(inputs) {',
    "  const source = Object.values(inputs)[0] ?? '';",
    `  const parts = source ? String(source).split(${JSON.stringify(separator)}) : [];`,
    '  return { items: parts, count: parts.length };',
    '}',
    '',
  ].join('\n');
}

/** A merge or split node becomes the code node it always was; ports and ids stay, so edges keep resolving. */
function migrateMergeSplit(node: Raw): Raw {
  const type = String(node.node_type);
  const config: Raw = { ...(isRecord(node.config) ? node.config : {}) };
  const separator = String(config.separator ?? '\n');
  delete config.separator;
  const mode = String(config.merge_mode ?? 'concat');
  delete config.merge_mode;
  config.code = type === 'merge' ? mergeCode(mode, separator) : splitCode(separator);
  config.batch_mode = 'whole_list';
  return { ...node, node_type: 'code', config };
}

// --- retired widget kinds ---------------------------------------------------

/** legacy widget kind -> canonical kind, and the mode it stood for. */
const LEGACY_WIDGET_KINDS: Record<string, { kind: string; mode: string }> = {
  heading: { kind: 'text', mode: 'heading' },
  file_open: { kind: 'input_picker', mode: 'file' },
  directory_open: { kind: 'input_picker', mode: 'directory' },
  text_window: { kind: 'text_io', mode: 'both' },
  chat_window: { kind: 'text_io', mode: 'both' },
};

function migrateWidgetKind(widget: Raw): Raw {
  const legacy = LEGACY_WIDGET_KINDS[String(widget.kind)];
  return legacy ? { ...widget, kind: legacy.kind, mode: widget.mode || legacy.mode } : widget;
}

// --- renamed fields ---------------------------------------------------------

const RENAMED_CONFIG_FIELDS: [string, string][] = [
  ['config_context_file', 'example_file'],
  ['output_context_file', 'example_file'],
];
const RENAMED_WIDGET_FIELDS: [string, string][] = [
  ['plot_prompt', 'code_prompt'],
  ['example_input_path', 'example_file'],
];

/** Move legacy keys onto their new names; the first non-empty value wins. */
function applyRenames(raw: Raw, renames: [string, string][]): Raw {
  let result: Raw | null = null;
  for (const [old, next] of renames) {
    if (!(old in raw)) continue;
    result ??= { ...raw };
    const value = result[old];
    delete result[old];
    if (value && !result[next]) result[next] = value;
  }
  return result ?? raw;
}

/** The input node's `recursive`/`extensions` were the only typed settings kept in the untyped `extra` bag. */
function liftSelectionFields(config: Raw): Raw {
  const extra = config.extra;
  if (!isRecord(extra) || !('recursive' in extra || 'extensions' in extra)) return config;
  const { recursive, extensions, ...remaining } = extra;
  const migrated: Raw = { ...config, extra: remaining };
  if ('recursive' in extra && !config.recursive) migrated.recursive = recursive;
  if ('extensions' in extra && !config.extensions) migrated.extensions = extensions;
  return migrated;
}

// --- retired layout --------------------------------------------------------

/** The cell footprint each retired `size` preset stood for. */
const LEGACY_SIZE_SPAN: Record<string, [number, number]> = { small: [3, 2], medium: [6, 4], large: [12, 6] };

function migrateWidgetSize(widget: Raw): Raw {
  if (!('size' in widget)) return widget;
  const { size, ...rest } = widget;
  const [w, h] = LEGACY_SIZE_SPAN[String(size ?? '')] ?? LEGACY_SIZE_SPAN.medium;
  return { w, h, ...rest };
}

/**
 * A placed 12-column layout becomes a document flow: the coordinates turn into
 * a sort key (reading order) and then go away; `w` is rescaled 12 -> 16.
 */
function migrateWidgetFlow(config: Raw): Raw {
  const widgets = config.gui_widgets;
  if (!Array.isArray(widgets) || !widgets.some((w) => isRecord(w) && ('x' in w || 'y' in w))) return config;
  const key = (widget: unknown, index: number): [number, number, number] => {
    if (!isRecord(widget)) return [0, 0, index];
    const { x, y } = widget;
    if (x === undefined || x === null || y === undefined || y === null) return [1, 1e6, index];
    return [0, Number(y), Number(x)];
  };
  const ordered = widgets
    .map((widget, index) => ({ widget, key: key(widget, index) }))
    .sort((a, b) => a.key[0] - b.key[0] || a.key[1] - b.key[1] || a.key[2] - b.key[2])
    .map(({ widget }) => {
      if (!isRecord(widget)) return widget;
      const { x, y, ...placed } = widget;
      void x; void y;
      if (typeof placed.w === 'number') placed.w = Math.max(1, Math.min(16, Math.round((placed.w * 16) / 12)));
      return placed;
    });
  const { gui_grid_columns, ...rest } = config;
  void gui_grid_columns;
  return { ...rest, gui_widgets: ordered };
}

// --- one node, all of it ----------------------------------------------------

function migrateFields(node: Raw): Raw {
  if (!isRecord(node.config)) return node;
  let config = liftSelectionFields(applyRenames(node.config, RENAMED_CONFIG_FIELDS));
  if (Array.isArray(config.gui_widgets)) {
    config = {
      ...config,
      gui_widgets: config.gui_widgets.map((w) => (isRecord(w)
        ? migrateWidgetSize(applyRenames(migrateWidgetKind(w), RENAMED_WIDGET_FIELDS))
        : w)),
    };
  }
  config = migrateWidgetFlow(config);
  return config === node.config ? node : { ...node, config };
}

/** One raw node dict, brought to the current DSL. Not a node at all passes through. */
export function migrateNode(raw: unknown): unknown {
  if (!isRecord(raw)) return raw;
  const type = String(raw.node_type);
  const node = type === 'merge' || type === 'split' ? migrateMergeSplit(raw) : migrateAliasNode(raw);
  return migrateFields(node);
}

/** A raw graph document, brought to the current DSL before it is parsed. */
export function migrateGraph(raw: unknown): unknown {
  if (!isRecord(raw) || !Array.isArray(raw.nodes)) return raw;
  return { ...raw, nodes: raw.nodes.map(migrateNode) };
}
