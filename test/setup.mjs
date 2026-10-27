// Loaded before every test file (package.json "test": node --import): the
// suite composes the Deployment manifest from a fixture, never from local
// Content repo checkouts: fixtures/content-repos/, copies of the Pilot's Doc
// space manifests (prefixed branches and tags, family Clouds with Cloud parts).
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.WSO2_DOCS_CONTENT_REPOS ??= path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'content-repos');
