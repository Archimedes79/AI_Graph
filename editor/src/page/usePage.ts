import type { GraphNode } from '@/graph';
import { useGraphStore } from '@/store/graphStore';
import { pageOf } from '@/document/guiWidgets';

/**
 * The page of the document the editor has open -- the node that is the page,
 * none before the first block makes it -- and its blocks, as they were drawn.
 * An edit that lands later reads the page from the store as it is then
 * (`pageWrite.ts`). The editor's own: a delivered tool is handed its page by
 * the runtime API, and never reaches this.
 */
export function usePage(): ReturnType<typeof pageOf> {
  return pageOf(useGraphStore((s) => s.rfNodes).map((n) => n.data.graphNode as GraphNode));
}
