// The spec (spec/) stays navigable: every spec file is listed in the index,
// carries its "Last checked against code" date, and every relative link in it
// resolves, to a file and, where it names one, to a heading anchor.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import GithubSlugger from 'github-slugger';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const specDir = path.join(root, 'spec');
const specFiles = fs.readdirSync(specDir).filter((f) => f.endsWith('.md')).sort();
const read = (file) => fs.readFileSync(file, 'utf8');
const withoutCode = (md) => md.replace(/^```[\s\S]*?^```/gm, '').replace(/`[^`\n]*`/g, '');

// Inline links [text](target) and reference definitions [label]: target.
function links(md) {
  const text = withoutCode(md);
  const inline = [...text.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]);
  const defs = [...text.matchAll(/^\[[^\]]+\]:\s+(\S+)/gm)].map((m) => m[1]);
  return [...inline, ...defs];
}

function anchors(md) {
  const slugger = new GithubSlugger();
  return new Set(withoutCode(md.replace(/`([^`\n]*)`/g, '$1'))
    .split('\n')
    .filter((line) => /^#{1,6}\s/.test(line))
    .map((line) => slugger.slug(line.replace(/^#+\s+/, '').replace(/\*\*/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').trim())));
}

test('spec: every spec file is listed in spec/README.md', () => {
  const index = read(path.join(specDir, 'README.md'));
  const listed = new Set([...index.matchAll(/\]\(([\w.-]+\.md)(?:#[^)]*)?\)/g)].map((m) => m[1]));
  const missing = specFiles.filter((f) => f !== 'README.md' && !listed.has(f));
  assert.deepEqual(missing, [], `add these to the Files table in spec/README.md: ${missing.join(', ')}`);
});

test('spec: every spec file says when it was last checked against code', () => {
  for (const f of specFiles) {
    const head = read(path.join(specDir, f)).split('\n').slice(0, 5).join('\n');
    assert.match(head, /^Last checked against code: \d{4}-\d{2}-\d{2}$/m, `${f}: needs a "Last checked against code: YYYY-MM-DD" line under its title`);
  }
});

test('spec: every relative link resolves', () => {
  const broken = [];
  for (const f of specFiles) {
    const file = path.join(specDir, f);
    for (const target of links(read(file))) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue; // https:, mailto:
      const [rel, anchor] = target.split('#');
      const dest = rel ? path.resolve(specDir, decodeURIComponent(rel)) : file;
      if (!fs.existsSync(dest)) {
        broken.push(`${f}: ${target} (no such file)`);
        continue;
      }
      if (anchor && dest.endsWith('.md') && !anchors(read(dest)).has(anchor)) broken.push(`${f}: ${target} (no such heading)`);
    }
  }
  assert.deepEqual(broken, []);
});
