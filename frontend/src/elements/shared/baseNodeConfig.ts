import type { NodeConfig } from '../../types/graph';

/**
 * The one `NodeConfig` shape every node type starts from -- every
 * NodeElementDefinition.create() spreads and overrides this rather than
 * repeating the full field list. Verbatim extraction of the object literal
 * every case in the old `utils/nodeDefaults.ts` switch used to build inline.
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
    selector_code: 'def run(inputs):\n    # inputs["files"] is the full list of file paths in the directory\n    return {"files": inputs.get("files", [])}\n',
    // 'default' -> follow the graph's metadata.ai_defaults (and whatever
    // overrides it at run time). There is no gen_ai_* pair any more: the
    // code-generation AI is one editor-wide setting, see store/settingsStore.ts.
    ai_provider: 'default',
    ai_model: '',
    system_prompt: '',
    temperature: 0.7,
    language: 'python',
    code: '',
    code_prompt: '',
    code_file: '',
    requirements: [],
    data_value: null,
    data_format: 'text',
    data_prompt: '',
    data_format_prompt: '',
    example_file: '',
    output_format: 'text',
    output_format_prompt: '',
    output_label: 'Result',
    write_mode: 'none',
    batch_mode: 'per_item',
    // 0 = follow the run's default concurrency; see NodeConfig.batch_concurrency.
    batch_concurrency: 0,
    read_file_inputs: false,
    send_images: false,
    gui_widgets: [],
    extra: {},
  };
}
