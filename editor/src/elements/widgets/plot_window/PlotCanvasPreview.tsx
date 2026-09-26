import { useEffect, useState } from 'react';
import type { GuiWidget } from '@/graph';
import { useGraphStore } from '@/store/graphStore';
import { scheme as schemeOf } from '@/ui/scheme';
import PlotChart from './PlotChart';
import { draw, type Drawn } from './draw';

/** How big the chart under a page's input port is: the size `PlotChart` draws at when it is not told. */
const PREVIEW = { width: 220, height: 90 };

/**
 * What the chart under a page's input port on the graph canvas shows: *data*
 * drawn by the chart's own code, as the page draws it -- at the preview's size,
 * in the page's scheme.
 */
export function previewDrawing(widget: GuiWidget, data: unknown, scheme: string): Promise<Drawn> {
  return draw(String(widget.code ?? ''), data ?? null, { ...PREVIEW, scheme, dark: schemeOf(scheme).light !== true });
}

/**
 * A chart, small, under its port on the canvas.
 *
 * It was the bare `PlotChart`, handed what arrived -- which for a chart is what
 * arrived untouched, since its code runs where it is drawn. Rows that the
 * chart's draw() turns into points drew an empty chart here while the page drew
 * the line. So the preview runs draw() as the page does; until that answers,
 * a chart with code shows nothing rather than the raw rows.
 */
export default function PlotCanvasPreview({ widget, data }: { widget: GuiWidget; data: unknown }) {
  const code = String(widget.code ?? '');
  const scheme = useGraphStore((s) => s.metadata.gui_scheme);
  const [drawn, setDrawn] = useState<Drawn>(() => (code.trim() ? { value: null } : { value: data }));

  // The last answer wins, as on the page: an older drawing that finishes late is dropped.
  useEffect(() => {
    let current = true;
    void previewDrawing(widget, data, scheme).then((answer) => { if (current) setDrawn(answer); });
    return () => { current = false; };
    // The block's code, not the block: moving or renaming it changes no drawing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, data, scheme]);

  return <PlotChart data={drawn.error ? `⚠ ${drawn.error}` : drawn.value} width={PREVIEW.width} height={PREVIEW.height} />;
}
