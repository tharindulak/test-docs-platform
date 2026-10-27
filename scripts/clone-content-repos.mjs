#!/usr/bin/env node
// Checks out the main line of every Content repo navigation.yaml lists
// (contentRepos, the Platform repo itself aside) into one directory, named
// as the repos: what compose reads in CI (--content / WSO2_DOCS_CONTENT_REPOS).
//   node scripts/clone-content-repos.mjs [--navigation <dir>] --out <dir> [--github-env]
// --github-env also sets WSO2_DOCS_CONTENT_REPOS for the job's later steps.
// Shallow, read-only clones from github.com. Private Content repos (the Pilot's
// are, until cutover) need a read-only token: CONTENT_READ_TOKEN, a workflow
// secret, sent as an HTTP header for these clones only (never in the URL or
// the clone's config). PENDING INFRA: the token itself.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import yaml from 'js-yaml';
import { DEFAULT_NAVIGATION } from '../lib/compose.mjs';

const { values: o } = parseArgs({ options: { navigation: { type: 'string' }, out: { type: 'string' }, 'github-env': { type: 'boolean' } } });
if (!o.out) {
  console.error('Usage: clone-content-repos.mjs [--navigation <dir>] --out <dir>');
  process.exit(2);
}
const nav = yaml.load(fs.readFileSync(path.join(o.navigation ?? DEFAULT_NAVIGATION, 'navigation.yaml'), 'utf8'));
fs.mkdirSync(o.out, { recursive: true });
for (const { repo } of nav.contentRepos ?? []) {
  if (repo.toLowerCase() === String(nav.platformRepo).toLowerCase()) continue;
  const dest = path.join(o.out, repo.split('/').pop());
  if (fs.existsSync(dest)) continue;
  const auth = process.env.CONTENT_READ_TOKEN
    ? ['-c', `http.https://github.com/.extraheader=AUTHORIZATION: basic ${Buffer.from(`x-access-token:${process.env.CONTENT_READ_TOKEN}`).toString('base64')}`]
    : [];
  execFileSync('git', [...auth, 'clone', '--quiet', '--depth', '1', '--branch', 'main', `https://github.com/${repo}.git`, dest], { stdio: 'inherit' });
  console.log(`${repo} → ${dest}`);
}
if (o['github-env'] && process.env.GITHUB_ENV) fs.appendFileSync(process.env.GITHUB_ENV, `WSO2_DOCS_CONTENT_REPOS=${path.resolve(o.out)}\n`);
