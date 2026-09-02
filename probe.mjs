import { writeFileSync, readFileSync } from 'node:fs';
const result = {};
try { writeFileSync('probe.txt', 'hi'); result.write = readFileSync('probe.txt', 'utf8'); }
catch (e) { result.write = `BLOCKED: ${e.code}`; }
try { const { execSync } = await import('node:child_process'); execSync('echo x'); result.spawn = 'ALLOWED'; }
catch (e) { result.spawn = `BLOCKED: ${e.code}`; }
console.log(JSON.stringify(result));
