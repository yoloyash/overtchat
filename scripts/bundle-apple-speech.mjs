import { readFile, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
const files = Object.fromEntries(await Promise.all(['server.py', 'requirements.lock'].map(async name =>
  [name, await readFile(new URL(`../speech/apple/${name}`, import.meta.url), 'utf8')])));
const compressed = gzipSync(JSON.stringify(files), { level: 9 });
// The gzip OS byte varies between Linux, macOS, and Windows. Keep the existing
// canonical Unix header so identical sources verify on every developer host.
compressed[9] = 3;
const output = `${JSON.stringify({ gzip: compressed.toString('base64') })}\n`;
const target = new URL('../apps/cli/src/generated/apple-speech.json', import.meta.url);
if (process.argv.includes('--check')) {
  if (await readFile(target, 'utf8') !== output) throw new Error('Run npm run speech:bundle');
} else await writeFile(target, output);
