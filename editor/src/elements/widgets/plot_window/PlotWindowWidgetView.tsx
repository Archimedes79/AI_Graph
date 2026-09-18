import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import PlotChart from './PlotChart';
import type { WidgetViewProps } from '../WidgetView';

/** Runtime `plot_window` widget: charts what flowed into `{id}_in`. Display-only. */
export default function PlotWindowWidgetView({ value, incoming }: WidgetViewProps) {
  // Display-only: the port value is the whole point, the stored value is only
  // a fallback for before the first run.
  const data = incoming !== undefined ? incoming : value;
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 320, height: 180 });

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
      setSize({ width: Math.round(box.width), height: Math.round(box.height) });
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
      setSize({ width: Math.round(box.width), height: Math.round(box.height) });
    }
  }, [data]);

  return (
    <div ref={containerRef} className="w-full h-full flex items-center justify-center" style={{ minHeight: 60 }}>
      <PlotChart data={data} width={size.width} height={size.height} />
    </div>
  );
}
