// The Platform package as npm packs it (npm pack, never published): its file
// list and the tarball, made once per test file and removed when it ends.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

let cachedPack;
export function pack() {
  if (cachedPack) return cachedPack;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wso2-pack-'));
  const r = spawnSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', dir], { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const [info] = JSON.parse(r.stdout);
  process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));
  cachedPack = { files: new Set(info.files.map((f) => f.path)), tarball: path.join(dir, info.filename) };
  return cachedPack;
}
