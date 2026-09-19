// Stop the editor: `node scripts/stop.mjs [--port 8000]`, which stop.cmd,
// stop.ps1 and stop.sh call. Only an AI-Graph server is stopped; see
// editorProcess.mjs.

import { readPort, stopEditor } from './editorProcess.mjs';

try {
  const port = readPort(process.argv.slice(2));
  console.log(await stopEditor(port) ? 'Editor stopped.' : `No editor is running on port ${port}.`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
