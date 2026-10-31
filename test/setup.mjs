// Loaded before every test file (scripts/test.mjs runs node --import): the
// suite composes the Deployment manifest from a fixture, never from local
// Content repo checkouts: fixtures/content-repos/, copies of the Pilot's Doc
// space manifests (prefixed branches and tags, family Clouds with Cloud parts).
// Each test file, and the CLIs it runs, gets a fresh cache folder of its own
// (WSO2_DOCS_CACHE), under the checkout's .cache/ since /tmp may be small, so
// no test reads what another run left in a shared cache.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
process.env.WSO2_DOCS_CONTENT_REPOS ??= path.join(root, 'fixtures', 'content-repos');

fs.mkdirSync(path.join(root, '.cache', 'test'), { recursive: true });
const cache = fs.mkdtempSync(path.join(root, '.cache', 'test', 'cache-'));
process.env.WSO2_DOCS_CACHE = cache;
process.on('exit', () => fs.rmSync(cache, { recursive: true, force: true }));
