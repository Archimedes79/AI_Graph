import type { NodeConfig } from '@/graph';

/**
 * The one `NodeConfig` shape every node type starts from -- every
 * `NODE_KINDS[type].create()` spreads and overrides this rather than
 * repeating the full field list. Verbatim extraction of the object literal
 * each create() used to build inline.
 */
export function baseNodeConfig(): NodeConfig {
  return {
    value: '',
    prompt_at_runtime: false,
    input_mode: 'text',
    recursive: false,
    extensions: '',
    select_all_files: true,
    selector_prompt: '',
    // Empty, as a folder picker's starts: an empty selector keeps every file,
    // which is all the starter it used to hold did -- saved into the graph of
    // every text and file input, which select nothing (B21).
    selector_code: '',
    // 'default' -> the one AI setting in ⚙ Settings (engine/src/ai/settings.ts
    // `aiSetting`), until someone pins this node to a provider of its own.
    ai_provider: 'default',
    ai_model: '',
    system_prompt: '',
    temperature: 0.7,
    code: '',
    code_prompt: '',
    data_value: null,
    data_format: 'text',
    data_prompt: '',
    data_format_prompt: '',
    output_format_prompt: '',
    output_label: 'Result',
    write_mode: 'none',
    // No batch_mode nor batch_concurrency: only code and ai run once per item
    // (`NodeRunner.fansOut`), and they start with both (`nodeKinds.ts`).
    read_file_inputs: false,
    send_images: false,
    gui_widgets: [],
  };
}
