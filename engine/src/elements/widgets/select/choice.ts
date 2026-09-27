// What a dropdown offers and what it stands at.
//
// Its own tiny module, like `text_io/role.ts`, because the page imports it too:
// a run emits the choice and the page shows it in the dropdown, and the two
// must be the same option. The page had a copy of its own, kept alike by hand.

/** One option per line; blank lines dropped, so a stray empty row is not a choice. */
export function selectOptions(raw: unknown): string[] {
  return String(raw ?? '').split('\n').map((line) => line.trim()).filter(Boolean);
}

/**
 * The option a dropdown stands at. A value from a retired option, or none yet:
 * the first option is the honest default, since that is what the dropdown
 * itself would show.
 */
export function selectChoice(options: string[], stored: unknown): string {
  const value = String(stored ?? '');
  return options.includes(value) ? value : (options[0] ?? '');
}
