import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useGraphStore } from '@/store/graphStore';
import { scheme as schemeOf } from '@/ui/scheme';
import PlotChart from './PlotChart';
import { draw, type Drawn } from './draw';
import type { WidgetViewProps } from '../WidgetView';

/**
 * Runtime `plot_window` widget: charts what flowed into `{id}_in`.
 *
 * The block's own code runs *here*, when the chart is drawn, and is handed the
 * size and the scheme — see `draw.ts` for why. So this component redraws on
 * three things and not only on new data: the value, the measured box, and the
 * page's scheme. A resize or a switch of scheme is a redraw with no run.
 */
export default function PlotWindowWidgetView({ widget, value, incoming }: WidgetViewProps) {
  // Display-only: the port value is the whole point, the stored value is only
  // a fallback for before the first run.
  const data = incoming !== undefined ? incoming : value;
  const code = String(widget.code ?? '');
  const scheme = useGraphStore((s) => s.metadata.gui_scheme);
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 320, height: 180 });
  const [drawn, setDrawn] = useState<Drawn>({ value: data });

  /**
   * Measure before the first paint, and again whenever the box changes.
   *
   * A ResizeObserver alone reported 188x90 for a block several hundred pixels
   * wide -- it had observed the element before the page laid out and nothing
   * resized afterwards to correct it. The chart then decided it had no room
   * for axes and drew none. `getBoundingClientRect` in a layout effect reads
   * the size that is actually on screen.
   */
  useLayoutEffect(() => {
    const measure = () => {
      const el = containerRef.current;
      if (!el) return;
      const box = el.getBoundingClientRect();
      if (box.width < 1 || box.height < 1) return;
      setSize((was) => (Math.round(box.width) === was.width && Math.round(box.height) === was.height
        ? was
        : { width: Math.round(box.width), height: Math.round(box.height) }));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // A block that was hidden when it first rendered -- a page tab not yet
  // shown -- has no size until it appears, and new data is the moment it
  // usually has.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    if (box.width >= 1 && box.height >= 1) {
      setSize((was) => (Math.round(box.width) === was.width && Math.round(box.height) === was.height
        ? was
        : { width: Math.round(box.width), height: Math.round(box.height) }));
    }
  }, [data]);

  /**
   * Run the body. Dropped rather than raced if another run starts first: a
   * drag across a resize handle fires this many times, and the answer wanted
   * is the last one, not whichever worker happened to finish last.
   */
  useEffect(() => {
    let current = true;
    const about = {
      width: size.width,
      height: size.height,
      scheme,
      dark: schemeOf(scheme).light !== true,
    };
    void draw(code, data ?? null, about).then((answer) => { if (current) setDrawn(answer); });
    return () => { current = false; };
  }, [code, data, size.width, size.height, scheme]);

  return (
    <div ref={containerRef} className="w-full h-full flex items-center justify-center" style={{ minHeight: 60 }}>
      {drawn.error
        ? <PlotChart data={`⚠ ${drawn.error}`} width={size.width} height={size.height} />
        : <PlotChart data={drawn.value} width={size.width} height={size.height} />}
    </div>
  );
}
