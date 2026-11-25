// Fails while any "[COMMITTEE TO CONFIRM" placeholder remains in index.html.
// Not part of npm test: it is EXPECTED to fail until the committee supplies the facts.
import { readFileSync } from 'node:fs';
const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const n = (html.match(/\[COMMITTEE TO CONFIRM/g) || []).length;
if (n) { console.error(`${n} [COMMITTEE TO CONFIRM] placeholder(s) remain in index.html. Do not merge.`); process.exit(1); }
console.log('No placeholders remain.');
