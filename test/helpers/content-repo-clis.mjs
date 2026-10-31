// The Platform's CLIs as a Content repo runs them (no Content repo checkouts),
// against the Pilot's world as published: shared by test/boilerplate.test.mjs
// and test/build/boilerplate.test.mjs.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPolicy, publicManifest } from '../../lib/manifest.mjs';

export const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const docsCli = path.join(root, 'bin', 'wso2-docs.mjs');
export const releaseCli = path.join(root, 'bin', 'wso2-release.mjs');
export const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `wso2-${name}-`));
export const git = (dir, ...args) => execFileSync('git', ['-C', dir, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
export const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');
// The CLIs as a Content repo runs them: no Content repo checkouts.
export const noCheckouts = () => {
  const env = { ...process.env, GITHUB_ACTIONS: '' };
  delete env.WSO2_DOCS_CONTENT_REPOS;
  delete env.WSO2_DOCS_MANIFEST;
  return env;
};
export const docs = (cwd, ...args) => spawnSync(process.execPath, [docsCli, ...args], { cwd, encoding: 'utf8', env: noCheckouts() });
export const release = (cwd, ...args) => spawnSync(process.execPath, [releaseCli, ...args], { cwd, encoding: 'utf8', env: noCheckouts() });

// The Pilot's world as published (staging), from the suite's fixture checkouts.
export const policy = loadPolicy();
export const publishedOf = (p = policy) => ({ schema: 1, environment: 'staging', ...publicManifest(p, { environment: 'staging' }) });
export const writePublished = (dir, published) => {
  const file = path.join(dir, 'manifest.json');
  fs.writeFileSync(file, JSON.stringify(published));
  return file;
};
// The section change merged first: api-platform lists a Doc space that is coming.
export const withComing = (slug, extra = {}) => {
  const p = structuredClone(policy);
  p.sections['api-platform'].pending = [{ at: 6, docSpace: slug, ...extra }, { at: 4, product: { label: 'MCP Hub', opens: { docSpace: slug } } }];
  return publishedOf(p);
};
