import React from 'react';
import { useGraphStore } from '../store/graphStore';

export default function TextOutputWindows() {
  const windows = useGraphStore((s) => s.textOutputWindows);
  const closeWindow = useGraphStore((s) => s.closeTextOutputWindow);

  if (windows.length === 0) return null;

  return (
    <div className="fixed z-40 flex flex-col-reverse gap-3" style={{ bottom: 16, right: 352 }}>
      {windows.map((win, i) => (
        <div
          key={win.nodeId}
          className="rounded-xl shadow-2xl flex flex-col"
          style={{
            width: 480,
            maxWidth: '90vw',
            height: 320,
            maxHeight: '60vh',
            resize: 'both',
            overflow: 'hidden',
            background: '#1a1d2e',
            border: '1px solid #2d3148',
            marginRight: i * 12,
          }}
        >
          <div
            className="flex items-center justify-between px-4 py-2 flex-shrink-0"
            style={{ background: '#0f1117', borderBottom: '1px solid #2d3148' }}
          >
            <span className="text-sm font-semibold flex items-center gap-2" style={{ color: '#e2e8f0' }}>
              🪟 {win.label}
            </span>
            <button
              onClick={() => closeWindow(win.nodeId)}
              style={{ color: '#94a3b8' }}
              className="hover:text-white text-sm"
            >
              ✕
            </button>
          </div>
          <pre
            className="flex-1 overflow-auto px-4 py-3 text-sm whitespace-pre-wrap"
            style={{ color: '#e2e8f0' }}
          >
            {win.content}
          </pre>
        </div>
      ))}
    </div>
  );
}
