/* Versionsstempel für CSS und Skripte in docs/index.html setzen (?v=JJJJMMTT-HHMM).
   Zweck: Nach einem Update laden Browser nie alte Skripte zu neuem HTML aus dem Zwischenspeicher.
   Aufruf: node scripts/stamp.mjs  (vor dem Commit, wenn sich js/ oder css/ geändert haben) */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const file = join(here, '..', 'docs', 'index.html');
const now = new Date();
const p2 = (n) => String(n).padStart(2, '0');
const v = `${now.getUTCFullYear()}${p2(now.getUTCMonth() + 1)}${p2(now.getUTCDate())}-${p2(now.getUTCHours())}${p2(now.getUTCMinutes())}`;
const html = readFileSync(file, 'utf8');
const out = html.replace(/(href="css\/[^"?]+\.css|src="js\/[^"?]+\.js)(\?v=[^"]*)?"/g, `$1?v=${v}"`);
const n = (out.match(new RegExp(`\\?v=${v}"`, 'g')) || []).length;
writeFileSync(file, out);
console.log(`Versionsstempel ${v} auf ${n} Dateien gesetzt.`);
