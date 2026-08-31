import React from 'react';
import { ACCENT_TEXT, LINE, MUTED, TEXT } from '../../ui/theme';

/**
 * A small markdown renderer, built as React elements rather than HTML.
 *
 * Deliberately not a library: `marked` is ~40 KB and `markdown-it` ~100 KB, and
 * every byte lands in each deploy bundle and each single-file executable. What a
 * page of this kind actually needs is a heading, a paragraph, emphasis, a link,
 * a list and a table — that is the subset below.
 *
 * **No `dangerouslySetInnerHTML`.** The text can come from a graph the user was
 * handed by someone else, and a bundle is opened in the recipient's browser, so
 * rendering it as markup would be an injection hole by construction. Building
 * elements means a `<script>` in the source is text, not a script.
 */

/** Inline: `code`, **bold**, *italic*, [link](url). Applied in that order. */
function inline(text: string, keyPrefix: string): React.ReactNode[] {
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(\[[^\]]+\]\([^)]+\))/g;
  const parts: React.ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    const token = match[0];
    const key = `${keyPrefix}-i${index++}`;
    if (token.startsWith('`')) {
      parts.push(
        <code key={key} style={{ background: 'rgba(255,255,255,0.06)', padding: '0 4px', borderRadius: 3 }}>
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith('**')) {
      parts.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('*')) {
      parts.push(<em key={key}>{token.slice(1, -1)}</em>);
    } else {
      const split = token.indexOf('](');
      const label = token.slice(1, split);
      const href = token.slice(split + 2, -1);
      // rel: the page may be opened from a bundle someone else built.
      parts.push(
        <a key={key} href={href} target="_blank" rel="noreferrer noopener" style={{ color: ACCENT_TEXT }}>
          {label}
        </a>,
      );
    }
    last = match.index + token.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function isTableRule(line: string): boolean {
  return /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(line) && line.includes('-');
}

function cells(line: string): string[] {
  return line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());
}

export function Markdown({ source }: { source: string }): React.ReactElement {
  const lines = (source ?? '').split('\n');
  const blocks: React.ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (!line.trim()) {
      index += 1;
      continue;
    }

    // Table: a header row followed by a |---|---| rule.
    if (line.includes('|') && index + 1 < lines.length && isTableRule(lines[index + 1])) {
      const header = cells(line);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
        rows.push(cells(lines[index]));
        index += 1;
      }
      blocks.push(
        <table key={`t${index}`} style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
          <thead>
            <tr>
              {header.map((cell, i) => (
                <th key={i} style={{ textAlign: 'left', padding: '4px 8px', borderBottom: `1px solid ${LINE}`, color: MUTED, fontWeight: 600 }}>
                  {inline(cell, `th${i}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => (
                  <td key={c} style={{ padding: '4px 8px', borderBottom: `1px solid ${LINE}`, color: TEXT }}>
                    {inline(cell, `td${r}-${c}`)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>,
      );
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const sizes = [20, 17, 15, 14];
      blocks.push(
        <div key={`h${index}`} style={{ fontSize: sizes[level - 1], fontWeight: 600, color: TEXT, margin: '2px 0' }}>
          {inline(heading[2], `h${index}`)}
        </div>,
      );
      index += 1;
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*[-*]\s+/, ''));
        index += 1;
      }
      blocks.push(
        <ul key={`u${index}`} style={{ margin: '2px 0', paddingLeft: 18, listStyle: 'disc', color: TEXT }}>
          {items.map((item, i) => <li key={i}>{inline(item, `li${index}-${i}`)}</li>)}
        </ul>,
      );
      continue;
    }

    // Paragraph: consecutive non-blank lines that started none of the above.
    const paragraph: string[] = [];
    while (index < lines.length && lines[index].trim()
           && !/^(#{1,4})\s+/.test(lines[index]) && !/^\s*[-*]\s+/.test(lines[index])) {
      paragraph.push(lines[index]);
      index += 1;
    }
    blocks.push(
      <p key={`p${index}`} style={{ margin: '2px 0', color: TEXT, lineHeight: 1.5 }}>
        {inline(paragraph.join(' '), `p${index}`)}
      </p>,
    );
  }

  return <div style={{ fontSize: 13 }}>{blocks}</div>;
}

export default Markdown;
