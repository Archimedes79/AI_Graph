import type { NodeConfig } from '@/graph';

/**
 * Every setting's one default: what the engine reads a key as when a graph
 * leaves it out.
 *
 * So it is three things at once. What a node read from a file is filled with
 * where the file says nothing (`normalizeGraphNode`); what a save leaves out,
 * key by key, because it says nothing the engine would not assume
 * (`savedNode`); and what every `NODE_KINDS[type].create()` starts from, so a
 * panel can read any field with a type. A new node that starts differently
 * -- a code node per item, an output node with a window -- says so in
 * `create`, and that is what its file then carries.
 *
 * One default per key: a second one, for what a *loaded* node lacks, is what
 * turned a graph written by hand into a different graph after one Save.
 * `savedConfig.test.ts` and `graphStore.test.ts` hold these to the engine.
 */
export function baseNodeConfig(): NodeConfig {
  return {
    value: '',
    prompt_at_runtime: false,
    input_mode: 'text',
    recursive: false,
    extensions: '',
    // 'default' -> the one AI setting in ⚙ Settings (engine/src/ai/settings.ts
    // `aiSetting`), until someone pins this node to a provider of its own.
    ai_provider: 'default',
    ai_model: '',
    system_prompt: '',
    code: '',
    code_prompt: '',
    data_value: null,
    data_format: 'text',
    output_format_prompt: '',
    // No label is the node's id as the key of the run's result.
    output_label: '',
    write_mode: 'none',
    // Once on the whole list (`NodeRunner.batchMode`), as many at once as the run allows.
    batch_mode: 'whole_list',
    batch_concurrency: 0,
    read_file_inputs: false,
    send_images: false,
    catch_errors: false,
    gui_widgets: [],
    task: '',
    trigger_on_start: true,
    trigger_every: '',
  };
}
