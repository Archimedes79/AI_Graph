// How a piece of prose is set: a heading, a paragraph or a caption.
//
// Its own tiny module, like `text_io/role.ts`, because the page imports it too:
// the page draws the block by it, and the designer writes into it by it. The
// page, the designer and the panel each had a reading of their own.

export type TextRole = 'heading' | 'body' | 'caption';

/** What a stored mode means: anything but the three is a paragraph. */
export function textRole(mode: unknown): TextRole {
  const role = String(mode ?? 'body');
  return (['heading', 'body', 'caption'].includes(role) ? role : 'body') as TextRole;
}
