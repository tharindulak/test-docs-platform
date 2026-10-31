import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// The cache folder when WSO2_DOCS_CACHE is unset: run from a git checkout of
// the Platform (a .git file or folder at the package root, as in a worktree),
// the checkout's own .cache/wso2-docs, so checkouts keep apart; installed from
// npm, ~/.cache/wso2-docs.
export function defaultCacheDir(root = PACKAGE_ROOT) {
  return fs.existsSync(path.join(root, '.git'))
    ? path.join(root, '.cache', 'wso2-docs')
    : path.join(os.homedir(), '.cache', 'wso2-docs');
}

// Where the CLIs keep composed manifests, default build outputs and other
// caches: WSO2_DOCS_CACHE when set, else defaultCacheDir().
export function cacheDir(...parts) {
  return path.join(process.env.WSO2_DOCS_CACHE || defaultCacheDir(), ...parts);
}
