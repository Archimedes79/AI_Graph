// Whether a node file has been handed to another editor in this session.
//
// Coming back to this window then means "the file may have changed", and the
// graph re-reads its node files on focus. Without the flag every alt-tab would
// reload from disk, for the great majority of graphs that keep nothing there.

let handedOut = false;

export function markExternalEdit(): void {
  handedOut = true;
}

export function externalEditsPossible(): boolean {
  return handedOut;
}
