// history.md: the whole conversation with the model about one node.
//
// Every exchange -- each ✨ (input, output, body), each change asked for and
// each fix -- is appended as it happened: a heading with the date, the time and
// which it was, then, for every model call it made, what was sent and what came
// back. Oldest first, newest last, and beyond `HISTORY_LIMIT` the oldest are
// dropped whole, so a node written a hundred times does not carry a book.
//
// The engine owns the format; the editor appends after each exchange, and the
// file is the node's like its code: read, diffed and opened as what it is.

import type { AICall } from '../host/api.ts';

/** How much history a node keeps: about 500 KB of text. */
export const HISTORY_LIMIT = 500 * 1024;

/** Where an exchange begins: its heading, with the date and the time it happened. */
const ENTRY = /^## \d{4}-\d{2}-\d{2} \d{2}:\d{2} · /m;

const pad = (n: number): string => String(n).padStart(2, '0');

/** *text* in a fence longer than any run of backticks inside it, so what it holds cannot close it. */
function fenced(text: string): string {
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((run) => run[0].length));
  const fence = '`'.repeat(longest + 1);
  return `${fence}\n${text.replace(/\r\n/g, '\n').replace(/\n+$/, '')}\n${fence}`;
}

/** One call as the history tells it: where it was sent, what, and what came back or how it failed. */
function told(call: AICall, n: number, of: number): string {
  const to = [call.provider, call.model].filter(Boolean).join(' ') || 'the model';
  const parts = [`### ${of > 1 ? `Call ${n} of ${of}, sent` : 'Sent'} to ${to}`];
  if (call.system.trim()) parts.push('System:', fenced(call.system));
  parts.push('Prompt:', fenced(call.prompt));
  if (call.error) parts.push(`### Failed after ${call.seconds} s`, fenced(call.error));
  else parts.push(`### Came back after ${call.seconds} s`, fenced(call.reply ?? ''));
  return parts.join('\n\n');
}

/**
 * One exchange as history.md keeps it: *which* it was -- "✨ Code", "Change:
 * also count the words" -- at *at*, local time, and each of its *calls*.
 */
export function exchangeEntry(which: string, calls: AICall[], at: Date): string {
  const when = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
  const heading = `## ${when} · ${which.replace(/\s+/g, ' ').trim()}`;
  if (!calls.length) return `${heading}\n\nNothing was sent.`;
  return [heading, ...calls.map((call, index) => told(call, index + 1, calls.length))].join('\n\n');
}

/**
 * *history* with *entry* appended, and as many of the oldest entries dropped
 * as it takes to stay within *limit* characters -- never the new one.
 */
export function withExchange(history: string, entry: string, limit = HISTORY_LIMIT): string {
  const before = history.replace(/\s+$/, '');
  let text = before ? `${before}\n\n${entry}` : entry;
  while (text.length > limit) {
    // Where the next entry after the first begins: everything before it goes.
    const next = ENTRY.exec(text.slice(1));
    const at = next ? next.index + 1 : -1;
    // Only what came before the new entry: it stays, however long it is.
    if (at <= 0 || at > text.length - entry.length) break;
    text = text.slice(at);
  }
  return text;
}
