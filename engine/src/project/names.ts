// What an id is called on disk.
//
// Its own file so that whatever *describes* a project folder (`flowFile.ts`) and
// whatever reads and writes one (`folder.ts`) name a node's folder the same way,
// without the one importing the other.

/** A folder name from an id: ids come from the file format and may hold anything. */
export function folderName(id: string): string {
  return id.replace(/[^\p{L}\p{N}_.-]/gu, '_').replace(/^\.+/, '_') || '_';
}
