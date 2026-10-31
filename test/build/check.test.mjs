// `wso2-docs check` end to end on a git copy of the stub Content repo: each
// blocking check fails on a crafted bad change and passes on a good one, and
// the checks that run on the preview build (Markdown twins, broken links).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { formatText, formatAnnotations } from '../../lib/check/index.mjs';
import { CATALOG, CATALOG_PAGE, PAGE, PNG, append, check, findings, git, read, reset, routesDir, status, tmp, write } from '../helpers/check-repo.mjs';

// One case per blocking check: [check id, bad change, good change].
const CASES = [
  ['compile', () => append(PAGE, '\nA bare <tag here.\n'), () => append(PAGE, '\nA bare `<tag>` here.\n')],
  ['markers', () => append(PAGE, '\nUse {edition.nope} here.\n'), () => append(PAGE, '\nUse {edition.productName} here.\n')],
  ['markers', () => append(PAGE, '\n<Edition only="cloudy">Text.</Edition>\n'), () => append(PAGE, '\n<Edition only="cloud">Text.</Edition>\n')],
  // An Edition variant: exactly one Cloud and one Self-hosted form (a catalogue component, so content-safety passes it).
  ['markers', () => append(PAGE, '\n<Variants>\n<Edition only="cloud">\nOpen the Console.\n</Edition>\n</Variants>\n'),
    () => append(PAGE, '\n<Variants>\n<Edition only="cloud">\nOpen the Console.\n</Edition>\n<Edition only="self-hosted">\nOpen the Management Console.\n</Edition>\n</Variants>\n')],
  // cloudCounterpart: on a Self-hosted-only page, naming a page Cloud shows.
  ['front-matter', () => write('docs/deploy-and-operate/tuning.mdx', '---\ntitle: Tune the server\ndescription: Tune the server.\ntype: how-to\neditions: self-hosted\ncloudCounterpart: guides/nope\n---\n\nText.\n'),
    () => write('docs/deploy-and-operate/tuning.mdx', '---\ntitle: Tune the server\ndescription: Tune the server.\ntype: how-to\neditions: self-hosted\ncloudCounterpart: guides/cloud-billing\n---\n\nText.\n')],
  ['front-matter', () => write('docs/deploy-and-operate/tuning.mdx', '---\ntitle: Tune the server\ndescription: Tune the server.\ntype: how-to\ncloudCounterpart: guides/cloud-billing\n---\n\nText.\n'),
    () => write('docs/deploy-and-operate/tuning.mdx', '---\ntitle: Tune the server\ndescription: Tune the server.\ntype: how-to\neditions: self-hosted\n---\n\nText.\n')],
  ['front-matter', () => write(PAGE, read(PAGE).replace(/^description: .*\n/m, '')), () => write(PAGE, read(PAGE).replace(/^description: .*\n/m, 'description: A shorter description.\n'))],
  ['front-matter', () => write(PAGE, read(PAGE).replace('type: how-to', 'type: how-to\nauthor: someone')), () => write(PAGE, read(PAGE).replace('type: how-to', 'type: how-to\nsidebar_label: MFA'))],
  ['front-matter', () => write(PAGE, read(PAGE).replace(/^description: .*$/m, `description: ${'A'.repeat(161)}`)), () => write(PAGE, read(PAGE).replace(/^description: .*$/m, `description: ${'A'.repeat(160)}`))],
  ['front-matter', () => write(PAGE, read(PAGE).replace('type: how-to', 'type: howto')), () => write(PAGE, read(PAGE).replace('type: how-to\n', ''))],
  ['skeleton', () => write('docs/tutorials/first.mdx', '---\ntitle: First\ndescription: A tutorial.\ntype: tutorial\n---\n\nText.\n'),
    () => write('docs/get-started/first.mdx', '---\ntitle: First\ndescription: A tutorial.\ntype: tutorial\n---\n\nText.\n')],
  ['redirects', () => git('mv', PAGE, 'docs/guides/multi-factor.mdx'), () => {
    git('mv', PAGE, 'docs/guides/multi-factor.mdx');
    write('redirects.yaml', read('redirects.yaml').replaceAll('to: guides/mfa\n', 'to: guides/multi-factor\n').replace('moves:\n', 'moves:\n  - from: guides/mfa\n    to: guides/multi-factor\n'));
    // The catalog's link to the page follows it too (the data-files check).
    write(CATALOG, read(CATALOG).replace('href: guides/mfa\n', 'href: guides/multi-factor\n'));
  }],
  ['redirects', () => write('redirects.yaml', read('redirects.yaml').replace('to: guides/mfa\n', 'to: guides/gone\n')), () => write('redirects.yaml', read('redirects.yaml').replace('to: guides/mfa\n', 'to: guides/cloud-billing\n'))],
  ['marker-versions', () => append(PAGE, '\n<Edition selfHostedFrom="7.2.0">Old news.</Edition>\n'), () => append(PAGE, '\n<Edition selfHostedFrom="7.4.0">Coming soon.</Edition>\n')],
  ['image-size', () => write('assets/img/big.png', Buffer.alloc(1100 * 1024, 1)), () => write('assets/img/small.png', Buffer.alloc(10 * 1024, 1))],
  ['image-alt', () => { write('assets/img/x.png', PNG); append(PAGE, '\n![](../../assets/img/x.png)\n'); },
    () => { write('assets/img/x.png', PNG); append(PAGE, '\n![The sign-in method editor with a TOTP step](../../assets/img/x.png)\n'); }],
  ['image-alt', () => append(PAGE, '\n<img src="/x.png" />\n'), () => append(PAGE, '\n<img src="/x.png" alt="The console home page" />\n')],
  ['docs-links', () => append(PAGE, '\nSee [publishing](docs:api-manager/latest/nope/).\n'), () => append(PAGE, '\nSee [publishing](docs:api-manager/latest/guides/#publish-an-api).\n')],
  ['docs-links', () => append(PAGE, '\nSee [publishing](docs:api-manager/latest/guides/#nope).\n'), () => append(PAGE, '\nSee [publishing](docs:api-manager/latest/guides/).\n')],
  ['docs-links', () => append(PAGE, '\nSee [x](docs:no-such-space/latest/guides/).\n'), () => append(PAGE, '\nSee [x](docs:api-manager/4.6.0/guides/).\n')],
  // Content safety: no code in content, build-breaking (never overridden).
  ['content-safety', () => append(PAGE, '\nexport const x = 1;\n'), () => append(PAGE, '\nThe export runs nightly.\n')],
  ['content-safety', () => append(PAGE, '\n<iframe src="https://example.com/embed/x" title="A video" />\n'), () => append(PAGE, '\n<iframe src="https://www.youtube-nocookie.com/embed/x" title="A video" />\n')],
  ['openapi', () => write('docs/reference/apis/applications/openapi.yaml', read('docs/reference/apis/applications/openapi.yaml').replace(/^info:/m, 'notinfo:')), () => {}],
  // Data files: a catalog's data file, and one known by its name.
  ['data-files', () => write(CATALOG, read(CATALOG).replace('href: guides/mfa\n', 'href: guides/nope\n')), () => write(CATALOG, read(CATALOG).replace('href: guides/mfa\n', 'href: get-started/quick-start\n'))],
  ['data-files', () => write(CATALOG, read(CATALOG).replace('    status: beta\n', '    status: preview\n')), () => write(CATALOG, read(CATALOG).replace('    status: beta\n', '    status: deprecated\n'))],
  ['data-files', () => write(CATALOG, read(CATALOG).replace('category: fraud-detection\n    status', 'category: crm\n    status')), () => {}],
  ['data-files', () => write(CATALOG_PAGE, read(CATALOG_PAGE).replace('data: ./connectors.yaml\n', '')), () => {}],
  ['data-files', () => write(CATALOG_PAGE, read(CATALOG_PAGE).replace('data: ./connectors.yaml', 'data: ./gone.yaml')), () => {}],
  ['data-files', () => write('docs/release-notes/release-notes.yaml', 'schemaVersion: 1\nreleases:\n  - version: 7.3.0\n    items: []\n'),
    () => write('docs/release-notes/release-notes.yaml', 'schemaVersion: 1\nreleases:\n  - version: 7.3.0\n    date: 2026-09-01\n    items: []\n')],
];

test('every blocking check fails on a bad change and passes on a good one', { timeout: 300_000 }, async (t) => {
  // docs:api-manager/4.6.0 needs its own route list for the last good case.
  fs.mkdirSync(path.join(routesDir, 'api-manager', '4.6.0'), { recursive: true });
  fs.writeFileSync(path.join(routesDir, 'api-manager', '4.6.0', 'pages.json'), JSON.stringify([{ path: 'guides/' }]));
  reset();
  const clean = await check();
  assert.equal(clean.result, 'pass', formatText(clean));
  assert.equal(clean.base.label, 'main');

  for (const [i, [id, bad, good]] of CASES.entries()) {
    await t.test(`${id} #${i}`, async () => {
      reset();
      bad();
      const b = await check();
      assert.equal(status(b, id), 'fail', `${id} should fail:\n${formatText(b)}`);
      assert.equal(b.result, 'fail');
      for (const f of findings(b, id)) assert.match(f.link, new RegExp(`/contribute/reference/checks/#${id}$`));
      reset();
      good();
      const g = await check();
      assert.equal(g.result, 'pass', `${id} good change should pass:\n${formatText(g)}`);
    });
  }
  reset();
});

test('Markdown twins: the Platform twin checks run on the build', { timeout: 600_000 }, async () => {
  reset();
  const build = path.join(tmp, 'build');
  const r = await check({ build: true, buildOut: build });
  assert.equal(status(r, 'twins'), 'pass', formatText(r));
  assert.match(r.checks.find((c) => c.id === 'twins').note, /^\d+ twins$/);
  const twin = path.join(build, 'guides', 'mfa.md');
  fs.appendFileSync(twin, '\n<Tabs>\n\nSee [gone](https://docs.wso2.com/identity-platform/cloud/identity-server/guides/gone/).\n');
  const bad = await check({ buildDir: build });
  assert.equal(status(bad, 'twins'), 'fail');
  const messages = findings(bad, 'twins').map((f) => f.message).join('\n');
  assert.match(messages, /leftover JSX/);
  assert.match(messages, /no such page/);
  reset();
});

test('the preview build fails on a broken link or anchor, with its file', { timeout: 600_000 }, async () => {
  reset();
  append('docs/get-started/quick-start.mdx', '\nSee [the factors](../guides/mfa.mdx#no-such-heading).\n');
  const r = await check({ build: true, edition: '7.3.0' });
  assert.equal(status(r, 'preview-build'), 'fail', formatText(r));
  const f = findings(r, 'preview-build')[0];
  assert.equal(f.file, 'docs/get-started/quick-start.mdx');
  assert.match(f.message, /#no-such-heading/);
  assert.match(formatAnnotations(r, 'content/'), /^::error file=content\/docs\/get-started\/quick-start\.mdx,line=1,title=Preview build::/m);
  reset();
});
