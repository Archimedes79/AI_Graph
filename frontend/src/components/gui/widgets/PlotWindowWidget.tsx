import React, { useEffect, useRef, useState } from 'react';
import PlotWidget from '../../PlotWidget';
import type { GuiWidgetRuntimeProps } from '../widgetProps';

/** Runtime `plot_window` widget: charts what flowed into `{id}_in`. Display-only. */
export default function PlotWindowWidget({ value, incoming }: GuiWidgetRuntimeProps) {
  // Display-only: the port value is the whole point, the stored value is only
  // a fallback for before the first run.
  const data = incoming !== undefined ? incoming : value;
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 220, height: 90 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      setSize({
        width: Math.max(120, Math.floor(el.clientWidth)),
        height: Math.max(60, Math.floor(el.clientHeight)),
      });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={containerRef} className="w-full h-full flex items-center justify-center" style={{ minHeight: 60 }}>
      <PlotWidget data={data} width={size.width} height={size.height} />
    </div>
  );
}
