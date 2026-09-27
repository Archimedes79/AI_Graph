import type { TextChange } from '@engine/host/api.ts';

/**
 * What the server said changed in a project on disk, held until the open
 * graph can take it.
 *
 * The server reports each change once (`changesOnDisk` marks it seen). A look
 * that came back after the editor had gone into a node's graph -- where the
 * changes, keyed by the top graph's node ids, cannot go -- dropped them, and
 * they were never reported again. They wait here instead, for the next look
 * at the top of the same project.
 */
export class DiskChanges {
  private path = '';
  private waiting: TextChange[] = [];

  /** *changes* reported for the project at *path*. Another project's are let go: it was read afresh. */
  arrived(path: string, changes: TextChange[]): void {
    if (path !== this.path) {
      this.path = path;
      this.waiting = [];
    }
    this.waiting.push(...changes);
  }

  /** Everything waiting for the project at *path*, handed over once. */
  due(path: string): TextChange[] {
    if (path !== this.path) return [];
    const due = this.waiting;
    this.waiting = [];
    return due;
  }
}
