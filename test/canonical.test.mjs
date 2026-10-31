// Canonicals (spec/indexing-and-seo.md): the rule the build writes into each
// page, and the page keeping it after hydration (Docusaurus sets the page's
// own URL again in the browser; site/src/theme/DocItem/Metadata keeps the
// served one).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalFor } from '../lib/canonical.mjs';
import { canonicalFor as fromOutputs } from '../plugins/platform-outputs.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

test('canonicalFor: latest and Cloud are their own; the latest feeder and older versions point at /latest/ while it has the page', () => {
  assert.equal(fromOutputs, canonicalFor);
  const o = { siteUrl: 'https://docs.wso2.com', docSpace: 'identity-server', latestEditionId: '7.3.0', latestPages: new Set(['', 'guides/mfa/']) };
  assert.equal(canonicalFor('guides/mfa/', { ...o, baseUrl: '/identity-server/latest/', editionId: '7.3.0', asLatest: true }), 'https://docs.wso2.com/identity-server/latest/guides/mfa/');
  assert.equal(canonicalFor('guides/x/', { ...o, baseUrl: '/identity-server/cloud/', editionId: 'cloud' }), 'https://docs.wso2.com/identity-server/cloud/guides/x/');
  assert.equal(canonicalFor('guides/only-here/', { ...o, baseUrl: '/identity-server/7.3.0/', editionId: '7.3.0' }), 'https://docs.wso2.com/identity-server/latest/guides/only-here/');
  assert.equal(canonicalFor('guides/mfa/', { ...o, baseUrl: '/identity-server/7.2.0/', editionId: '7.2.0' }), 'https://docs.wso2.com/identity-server/latest/guides/mfa/');
  assert.equal(canonicalFor('guides/old/', { ...o, baseUrl: '/identity-server/7.2.0/', editionId: '7.2.0' }), 'https://docs.wso2.com/identity-server/7.2.0/guides/old/');
  // After a page move, an older version's page takes the renamed /latest/ page.
  assert.equal(canonicalFor('guides/multi-factor-auth/', { ...o, baseUrl: '/identity-server/7.2.0/', editionId: '7.2.0', latestRedirects: { 'guides/multi-factor-auth/': 'guides/mfa/' } }), 'https://docs.wso2.com/identity-server/latest/guides/mfa/');
});

test('the page keeps the canonical and og:url it was served with', () => {
  const wrapper = fs.readFileSync(path.join(root, 'site', 'src', 'theme', 'DocItem', 'Metadata', 'index.js'), 'utf8');
  assert.match(wrapper, /querySelector\('link\[rel="canonical"\]'\)/);
  assert.match(wrapper, /<link rel="canonical" href=\{keep\.canonical\} \/>/);
  assert.match(wrapper, /<meta property="og:url" content=\{keep\.ogUrl\} \/>/);
});
