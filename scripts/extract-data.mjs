// Extracts RAW data blob from solar_subcon_simulator.html → src/data.js
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const root = join(__dir, '..');

const html = readFileSync(join(root, 'solar_subcon_simulator.html'), 'utf8');

// Extract the RAW = {...} assignment (single line)
const match = html.match(/^const RAW = (\{.+\});?\s*$/m);
if (!match) throw new Error('RAW not found');

const raw = JSON.parse(match[1]);

// Validate
const n = raw.ids.length;
console.log(`Tables: ${n}, Zones: ${[...new Set(raw.zones)].length}, Subs: ${raw.subs.length}`);
if (!raw.ids || !raw.zones || !raw.xs || !raw.ys || !raw.phases || !raw.ms || !raw.pv || !raw.subs)
  throw new Error('Missing expected fields in RAW');

mkdirSync(join(root, 'src'), { recursive: true });

const out = `// Auto-generated from solar_subcon_simulator.html — do not edit by hand.
// Re-generate: node scripts/extract-data.mjs

export const RAW = ${JSON.stringify(raw)};

export const TABLES = RAW.ids.map((id, i) => ({
  id,
  zone: RAW.zones[i],
  x: RAW.xs[i],
  y: RAW.ys[i],
  ph: RAW.phases[i],
  realMs: RAW.ms[i],
  realPv: RAW.pv[i],
}));

export const ZONES = [...new Set(TABLES.map(t => t.zone))].sort((a, b) => a - b);
export const SUBS_RAW = RAW.subs; // [{name, color}]

export const TOTAL_TABLES = 3524;
export const TOTAL_MWP = 65.018;
export const MWP_PER_TABLE = TOTAL_MWP / TOTAL_TABLES;

export const TOTAL_BY_ZONE = Object.fromEntries(
  ZONES.map(z => [z, TABLES.filter(t => t.zone === z).length])
);

export const TABLES_BY_ZONE = Object.fromEntries(
  ZONES.map(z => [z, TABLES.filter(t => t.zone === z)])
);
`;

writeFileSync(join(root, 'src', 'data.js'), out, 'utf8');
console.log('Written: src/data.js');
