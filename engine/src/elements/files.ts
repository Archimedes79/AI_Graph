// Listing a folder, and letting an authored selector narrow it.
//
// Shared by the input node and the file-picker block: one contract at two
// levels, implemented once, which is what stops the two from drifting apart
// the first time either is changed.
import { type Runtime } from '../element.ts';
import { Logic } from '../logic.ts';

/**
 * List a folder, then let an authored selector narrow it.
 *
 * The same behaviour the file-picker block runs one level down, through this
 * same function — one contract at two levels, implemented once, which is what
 * stops the two from drifting apart the first time either is changed.
 */
export async function selectFiles(
  logic: Logic | undefined,
  settings: { recursive: boolean; extensions: string; selectAll: boolean },
  path: string,
  runtime: Runtime,
): Promise<string[]> {
  const extensions = settings.extensions
    .split(',').map((e) => e.trim()).filter(Boolean)
    .map((e) => (e.startsWith('.') ? e : `.${e}`));

  let files = await runtime.files.list(path, {
    recursive: settings.recursive,
    extensions: extensions.length ? extensions : undefined,
  });

  if (!settings.selectAll && logic && !logic.isEmpty) {
    const chosen = await logic.run({ files }, runtime.code);
    if (Array.isArray(chosen.files)) files = chosen.files.map(String);
  }
  return files;
}
