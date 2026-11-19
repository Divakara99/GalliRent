import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = resolve(root, 'terms.html');
const outputPath = resolve(root, 'lib/legal.generated.ts');

const html = await readFile(sourcePath, 'utf8');

const requiredPhrases = [
  'no guarantee that any listed property is still vacant',
  'strictly non-refundable',
  '₹0.05',
  '₹0.00 is credited',
  '₹500.00',
  '75%',
  '3–7 working days',
  'within 24 hours',
  'full wallet forfeiture',
  '₹0.50',
  'Privacy Policy',
];

for (const phrase of requiredPhrases) {
  if (!html.includes(phrase)) {
    throw new Error(`terms.html is missing required compliance phrase: ${phrase}`);
  }
}

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(
  outputPath,
  `/* Generated from terms.html by scripts/generate-legal.mjs. Do not edit by hand. */\n` +
    `export const TERMS_HTML = ${JSON.stringify(html)};\n` +
    `export const TERMS_EFFECTIVE_DATE = '2026-11-16';\n`,
  'utf8',
);

console.log(`Generated ${outputPath}`);
