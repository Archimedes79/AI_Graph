// Every package this workspace installs, held to the licences it may come under.
//
// Read from package-lock.json, which records each package's licence as the
// package declares it: the list `npm ci` installs, so a dependency whose terms
// change fails here on the push that brings it in (CI, "Licences").
//
// What the page is built from goes with every copy of it, so those packages
// must be permissive: their one condition is that their notice travels along,
// which `licenses.txt` in the built page sees to (editor/vite.config.ts). A
// development tool goes no further than the container image, where npm puts it
// in a folder of its own with its own licence file, so it may also come under
// terms that ask no more than that -- the browser data a CSS tool reads
// (CC-BY-4.0), the Python licence of an argument parser. docs/licenses.md says
// the same for people.

import { readFileSync } from 'node:fs';

const PERMISSIVE = ['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', '0BSD'];
const DEVELOPMENT = [...PERMISSIVE, 'CC0-1.0', 'CC-BY-4.0', 'Python-2.0', 'BlueOak-1.0.0'];
/** Development tools that write code of their own into the page (editor/vite.config.ts says which). */
const WRITE_INTO_THE_PAGE = ['vite', 'tailwindcss'];

/**
 * Whether an SPDX expression holds under *allowed*: one side of an OR, every
 * part of an AND. One that mixes the two is left to a person to read.
 */
function allowedBy(expression, allowed) {
  const ids = expression.replace(/^\((.*)\)$/, '$1');
  if (/\bAND\b/.test(ids) && /\bOR\b/.test(ids)) return false;
  return /\bOR\b/.test(ids)
    ? ids.split(/\s+OR\s+/).some((id) => allowed.includes(id))
    : ids.split(/\s+AND\s+/).every((id) => allowed.includes(id));
}

const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
const groups = { page: new Map(), development: new Map() };
const refused = [];
for (const [path, entry] of Object.entries(lock.packages)) {
  // The workspace, and its own packages linked into node_modules: this project.
  if (!path.includes('node_modules/') || entry.link) continue;
  const name = path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length);
  const license = typeof entry.license === 'string' ? entry.license : '';
  const group = entry.dev && !WRITE_INTO_THE_PAGE.includes(name) ? 'development' : 'page';
  if (!license || !allowedBy(license, group === 'page' ? PERMISSIVE : DEVELOPMENT)) {
    refused.push(`  ${name} ${entry.version}: ${license || 'no licence given'}${group === 'page' ? '' : ' (a development tool)'}`);
  }
  groups[group].set(license || 'none', (groups[group].get(license || 'none') ?? 0) + 1);
}

const line = (counts) => [...counts].sort((a, b) => b[1] - a[1]).map(([license, n]) => `${license} ${n}`).join(', ');
const total = (counts) => [...counts.values()].reduce((sum, n) => sum + n, 0);
console.log(`What the page may be built from (${total(groups.page)} packages): ${line(groups.page)}`);
console.log(`Development only (${total(groups.development)} packages): ${line(groups.development)}`);
if (refused.length) {
  console.error(`\nNot under a licence this project allows (see docs/licenses.md):\n${refused.join('\n')}`);
  process.exit(1);
}
console.log('Every one of them under a licence this project allows.');
