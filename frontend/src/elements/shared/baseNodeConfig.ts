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
    ai_provider: 'ollama',
    ai_model: 'llama3',
    gen_ai_provider: 'ollama',
    gen_ai_model: 'llama3',
    system_prompt: '',
    temperature: 0.7,
    language: 'python',
    code: '',
    code_prompt: '',
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
