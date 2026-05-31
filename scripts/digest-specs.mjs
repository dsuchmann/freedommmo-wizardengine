import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const specDir = 'specs';
const files = readdirSync(specDir).filter(file => file.endsWith('.md')).sort();
const sections = [];
for (const file of files) {
  const path = join(specDir, file);
  const text = readFileSync(path, 'utf8');
  const headings = [...text.matchAll(/^#{1,4}\s+(.+)$/gm)].map(match => match[1]).slice(0, 30);
  const principles = extractLines(text, ['must', 'should', 'validation', 'failure mode', 'algorithm', 'outputs', 'inputs', 'performance', 'asset', 'biome', 'layer', 'draw', 'manifest']);
  sections.push(`## ${file}\n\n### Headings\n${headings.map(h => `- ${h}`).join('\n') || '- none'}\n\n### Key Lines\n${principles.slice(0, 80).map(line => `- ${line}`).join('\n') || '- none'}\n`);
}
const output = `# Spec Digest\n\nGenerated from ${files.length} spec docs. Use this as a quick living-spec reread aid; source specs remain canonical.\n\n${sections.join('\n')}\n`;
writeFileSync('docs/SPEC_DIGEST.md', output);
console.log(`Digested ${files.length} spec docs`);

function extractLines(text, needles) {
  return text.split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && needles.some(needle => line.toLowerCase().includes(needle)))
    .map(line => line.replace(/\s+/g, ' '));
}
