import React from 'react';
import type { GuiWidgetRuntimeProps } from '../widgetProps';
import { DIMMER, LINE, MUTED, TEXT } from '../../../ui/theme';

/**
 * Rows, as a table. Display-only, like the plot: one input port, no output.
 *
 * Accepts the two shapes data actually arrives in — a list of objects sharing
 * their keys (keys become the header) or a list of lists whose first row is the
 * header. Anything else is shown as text rather than silently rendered empty,
 * because "my table is blank" is the least helpful failure there is.
 */
function toRows(value: unknown): { header: string[]; rows: string[][] } | null {
  let data = value;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(data) || data.length === 0) return null;

  const first = data[0];
  if (Array.isArray(first)) {
    const [header, ...rest] = data as unknown[][];
    return {
      header: header.map(String),
      rows: rest.map((row) => (Array.isArray(row) ? row.map(cellText) : [cellText(row)])),
    };
  }
  if (first && typeof first === 'object') {
    // Union of keys, first-seen order: a row missing a key gets a blank cell
    // rather than shifting every column after it.
    const header: string[] = [];
    for (const row of data as Record<string, unknown>[]) {
      for (const key of Object.keys(row ?? {})) if (!header.includes(key)) header.push(key);
    }
    return {
      header,
      rows: (data as Record<string, unknown>[]).map((row) => header.map((key) => cellText(row?.[key]))),
    };
  }
  return null;
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export default function TableWidget({ widget, value, incoming }: GuiWidgetRuntimeProps) {
  const data = incoming !== undefined ? incoming : value;
  const table = toRows(data);

  if (!table) {
    const text = data === undefined || data === null || data === ''
      ? 'Keine Daten'
      : typeof data === 'string' ? data : JSON.stringify(data);
    return (
      <div className="text-xs h-full overflow-auto" style={{ color: DIMMER }} title={widget.label}>
        {text}
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
        <thead>
          <tr>
            {table.header.map((cell, i) => (
              <th
                key={i}
                style={{
                  textAlign: 'left', padding: '3px 8px', position: 'sticky', top: 0,
                  borderBottom: `1px solid ${LINE}`, color: MUTED, fontWeight: 600,
                  background: 'rgba(15,17,23,0.95)',
                }}
              >
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, r) => (
            <tr key={r}>
              {row.map((cell, c) => (
                <td key={c} style={{ padding: '3px 8px', borderBottom: `1px solid ${LINE}`, color: TEXT }}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
