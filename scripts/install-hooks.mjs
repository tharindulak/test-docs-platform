// npm's prepare step (npm ci, npm install in a checkout): points git at
// .githooks/, so the pre-commit hook runs the fast tests. Only in a git
// checkout of the Platform itself (.git at the package root): an installed
// copy inside someone else's repo leaves that repo's hooks alone.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
if (fs.existsSync(path.join(root, '.git')) && fs.existsSync(path.join(root, '.githooks'))) {
  spawnSync('git', ['-C', root, 'config', 'core.hooksPath', '.githooks'], { stdio: 'ignore' });
}
