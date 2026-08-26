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
    data_value: null,
    data_format: 'text',
    data_prompt: '',
    data_format_prompt: '',
    config_context_file: '',
    output_format: 'text',
    output_format_prompt: '',
    output_context_file: '',
    output_label: 'Result',
    write_mode: 'none',
    batch_mode: 'per_item',
    read_file_inputs: false,
    gui_widgets: [],
    gui_grid_columns: 12,
    extra: {},
  };
}
