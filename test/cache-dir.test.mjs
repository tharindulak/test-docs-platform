import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { cacheDir, defaultCacheDir } from '../lib/cache-dir.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

test('the cache folder is WSO2_DOCS_CACHE when set, else the default', () => {
  const saved = process.env.WSO2_DOCS_CACHE;
  try {
    delete process.env.WSO2_DOCS_CACHE;
    assert.equal(cacheDir('build', 'sandbox'), path.join(defaultCacheDir(), 'build', 'sandbox'));
    process.env.WSO2_DOCS_CACHE = '/work/agent-a/cache';
    assert.equal(cacheDir('composed'), '/work/agent-a/cache/composed');
  } finally {
    if (saved === undefined) delete process.env.WSO2_DOCS_CACHE; else process.env.WSO2_DOCS_CACHE = saved;
  }
});

test('the default is the checkout\'s .cache/wso2-docs in a git checkout (folder or worktree file), else ~/.cache/wso2-docs', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wso2-cache-dir-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const installed = path.join(dir, 'node_modules', '@wso2', 'docs');
  const checkout = path.join(dir, 'docs-platform');
  const worktree = path.join(dir, 'docs-platform-wt', 'task');
  fs.mkdirSync(installed, { recursive: true });
  fs.mkdirSync(path.join(checkout, '.git'), { recursive: true });
  fs.mkdirSync(worktree, { recursive: true });
  fs.writeFileSync(path.join(worktree, '.git'), `gitdir: ${checkout}/.git/worktrees/task\n`);
  assert.equal(defaultCacheDir(installed), path.join(os.homedir(), '.cache', 'wso2-docs'));
  assert.equal(defaultCacheDir(checkout), path.join(checkout, '.cache', 'wso2-docs'));
  assert.equal(defaultCacheDir(worktree), path.join(worktree, '.cache', 'wso2-docs'));
  assert.equal(defaultCacheDir(), path.join(root, '.cache', 'wso2-docs'), 'this checkout');
});
