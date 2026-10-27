// The product cards of a family-level overview (Platform-by-platform
// walkthrough), shared by the family converter (family.mjs) and a family that
// converts like a product (run.mjs, config.parts).
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

// The overview's product cards (Platform-by-platform walkthrough: one card
// per product, drawn by the overview layout): an H3 per Cloud part with its
// description, a link to its Cloud and, when it has Self-hosted versions, to
// its newest release. `repoDir` is the Content repo checkout holding the
// parts' directories.
export function productCards(parts, repoDir) {
  const lines = ['## Products', ''];
  for (const p of parts) {
    const file = path.join(repoDir, p.docSpace, 'docspace.yaml');
    const m = fs.existsSync(file) ? yaml.load(fs.readFileSync(file, 'utf8')) ?? {} : {};
    const selfHosted = (m.editions ?? []).some((e) => (typeof e === 'string' ? e : e.id) !== 'cloud');
    lines.push(`### ${p.title}`, '', `${p.description.replace(/^./, (c) => c.toUpperCase())}`, '', `- [${p.title} Cloud](docs:${p.docSpace}/cloud/)`);
    if (selfHosted) lines.push(`- [${p.title} Self-hosted (newest release)](docs:${p.docSpace}/latest/)`);
    lines.push('');
  }
  return lines;
}
