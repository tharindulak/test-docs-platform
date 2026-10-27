#!/usr/bin/env node
// Report jobs run by nightly-reports.yml and weekly-digest.yml. Report only:
// nothing here blocks a merge or a release.
//   matrix                          live Doc spaces and deployments, as JSON for workflow matrices
//   digest --space <slug> [--days 7] [--env production] [--fixtures <json>] [--out <dir>]
//   lint-counts <check.json>...     a Markdown table of lint counts per Content repo
//   a11y-urls --sitemap <url|file> [--sample <n>] [--seed <s>]   a pa11y-ci config for axe
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { DEFAULT_POLICY, loadPolicy } from '../lib/manifest.mjs';
import { collectDigest, renderDigest } from '../lib/digest.mjs';
import { lintCounts, liveSpaces, sampleUrls } from '../lib/reports.mjs';

const USAGE = 'Usage: wso2-reports matrix | digest --space <slug> | lint-counts <check.json>... | a11y-urls --sitemap <url>';

async function main(argv) {
  const [command, ...rest] = argv;
  const { values: o, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      policy: { type: 'string' }, space: { type: 'string' }, days: { type: 'string' }, env: { type: 'string' },
      fixtures: { type: 'string' }, out: { type: 'string' }, sitemap: { type: 'string' }, sample: { type: 'string' }, seed: { type: 'string' },
    },
  });
  const policy = loadPolicy(o.policy ? path.resolve(o.policy) : DEFAULT_POLICY);
  switch (command) {
    case 'matrix': {
      const spaces = liveSpaces(policy, o.env ?? 'production');
      console.log(JSON.stringify({
        spaces: spaces.map(({ segments, ...s }) => s),
        repos: spaces.filter((s) => s.repo && s.model !== 'unversioned').map((s) => ({ space: s.space, repo: s.repo })),
        deployments: spaces.flatMap((s) => s.segments.map((segment) => ({ space: s.space, segment, path: segment === '_' ? `/${s.space}/` : `/${s.space}/${segment}/` }))),
      }));
      return 0;
    }
    case 'digest': {
      if (!o.space) throw new Error('--space is required');
      const s = liveSpaces(policy, o.env ?? 'production').find((x) => x.space === o.space);
      if (!s) throw new Error(`"${o.space}" is not a live Doc space`);
      const digest = await collectDigest({
        space: s.space, repo: s.issuesRepo, days: Number(o.days ?? 7), environment: o.env ?? 'production',
        fixtures: o.fixtures ? JSON.parse(fs.readFileSync(o.fixtures, 'utf8')) : null,
      });
      const md = renderDigest(digest, { displayName: s.displayName });
      if (o.out) {
        fs.mkdirSync(o.out, { recursive: true });
        fs.writeFileSync(path.join(o.out, `${s.space}.md`), md);
        fs.writeFileSync(path.join(o.out, `${s.space}.json`), `${JSON.stringify(digest, null, 2)}\n`);
      }
      console.log(md);
      return 0;
    }
    case 'lint-counts': {
      console.log(lintCounts(positionals.map((f) => JSON.parse(fs.readFileSync(f, 'utf8')))));
      return 0;
    }
    case 'a11y-urls': {
      if (!o.sitemap) throw new Error('--sitemap is required');
      const xml = /^https?:/.test(o.sitemap) ? await (await fetch(o.sitemap)).text() : fs.readFileSync(o.sitemap, 'utf8');
      const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
      const picked = sampleUrls(urls, Number(o.sample ?? 20), o.seed ?? new Date().toISOString().slice(0, 10));
      console.log(JSON.stringify({ defaults: { runners: ['axe'], standard: 'WCAG2AA', timeout: 60000 }, urls: picked }, null, 2));
      return 0;
    }
    default:
      console.log(USAGE);
      return command ? 2 : 0;
  }
}

main(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
}, (err) => {
  console.error(`wso2-reports: ${err.message}`);
  process.exitCode = 1;
});
