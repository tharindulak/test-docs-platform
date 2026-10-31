#!/usr/bin/env node
// npm test: the Platform's test suite with the working rules built in.
//
//   npm test                          every test: test/ and test/build/
//   npm test -- test/foo.test.mjs     only the files (or globs) named; other
//                                     node --test options pass through, as
//                                     --name=value
//   npm run test:fast                 test/ only, no builds
//
// - The machine's build lock: when the Platform checkout has a worktree folder
//   beside it (<main checkout>-wt/), a run that includes a build test
//   (test/build/) waits for <main checkout>-wt/_build.lock, so heavy runs on
//   one machine go one at a time. On CI, or anywhere without that folder, no
//   lock. WSO2_DOCS_BUILD_LOCK names another lock file; set it empty for none.
// - A 1500 s timeout from when the lock is held, after which the run is stopped.
// - Test files one at a time when builds run (they share site/.docusaurus);
//   up to 8 at once otherwise, so test:fast stays well under a minute.
// - DOCUSAURUS_NO_PERSISTENT_CACHE=1: the Docusaurus cache doesn't see changes
//   to the Platform's own code, so the suite never uses it.
// - Optional tools, found when not set: ACTIONLINT (actionlint on PATH) and
//   WSO2_DOCS_SANDBOX (docs-sandbox beside the main checkout). Vale is found
//   on PATH by lib/check/lint.mjs itself.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const testDir = path.join(root, 'test');
const TIMEOUT_MS = 1500 * 1000;
const LOCKED = 'WSO2_DOCS_TEST_LOCK_HELD';

const args = process.argv.slice(2);
const named = args.filter((a) => !a.startsWith('-'));
const files = named.length ? [] : [path.join(root, 'test', '*.test.mjs'), path.join(root, 'test', 'build', '*.test.mjs')];
// A run is light when every file named sits in test/ itself (a glob there
// too); anything else may reach test/build/.
const builds = named.length ? named.some((f) => path.dirname(path.resolve(f)) !== testDir) : true;

// The main checkout: the folder that holds git's common dir (a worktree's
// .git file points into it).
function mainCheckout() {
  const r = spawnSync('git', ['-C', root, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' });
  return r.status === 0 ? path.dirname(r.stdout.trim()) : null;
}

function buildLock() {
  if (process.env.WSO2_DOCS_BUILD_LOCK !== undefined) return process.env.WSO2_DOCS_BUILD_LOCK || null;
  const main = mainCheckout();
  const worktrees = main && `${main}-wt`;
  return worktrees && fs.existsSync(worktrees) ? path.join(worktrees, '_build.lock') : null;
}

function onPath(bin) {
  for (const dir of (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)) {
    const p = path.join(dir, bin);
    try {
      fs.accessSync(p, fs.constants.X_OK);
      return p;
    } catch {}
  }
  return null;
}

function env() {
  const e = { ...process.env, DOCUSAURUS_NO_PERSISTENT_CACHE: '1' };
  delete e[LOCKED];
  if (!e.ACTIONLINT) {
    const actionlint = onPath('actionlint');
    if (actionlint) e.ACTIONLINT = actionlint;
  }
  if (!e.WSO2_DOCS_SANDBOX) {
    const main = mainCheckout();
    const sandbox = main && path.join(path.dirname(main), 'docs-sandbox');
    if (sandbox && fs.existsSync(path.join(sandbox, '.git'))) e.WSO2_DOCS_SANDBOX = sandbox;
  }
  return e;
}

// Runs node --test in its own process group, so the timeout or a Ctrl-C
// stops the test files and everything they started.
function run() {
  const concurrency = builds ? 1 : Math.min(8, os.availableParallelism());
  const child = spawn(process.execPath, ['--import', path.join(root, 'test', 'setup.mjs'), '--test', `--test-concurrency=${concurrency}`, ...args, ...files], {
    env: env(), stdio: 'inherit', detached: true,
  });
  const stop = (signal) => {
    try { process.kill(-child.pid, signal); } catch {}
  };
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    console.error(`\nnpm test: stopped after ${TIMEOUT_MS / 1000} s`);
    stop('SIGTERM');
    setTimeout(() => stop('SIGKILL'), 10_000).unref();
  }, TIMEOUT_MS);
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => stop(signal));
  child.on('exit', (code, signal) => {
    clearTimeout(timer);
    stop('SIGTERM'); // anything a test file left running
    process.exit(timedOut ? 124 : code ?? (signal ? 1 : 0));
  });
}

const lock = builds && !process.env[LOCKED] ? buildLock() : null;
if (lock) {
  // Hold the lock with flock(1) while this script runs again inside it; -o
  // keeps the lock from leaking into servers the tests start.
  console.error(`npm test: waiting for the build lock ${lock}`);
  const r = spawnSync('flock', ['-o', lock, process.execPath, fileURLToPath(import.meta.url), ...args], {
    stdio: 'inherit', env: { ...process.env, [LOCKED]: '1' },
  });
  if (r.error) {
    console.error(`npm test: can't take the build lock with flock: ${r.error.message}`);
    process.exit(1);
  }
  process.exit(r.status ?? 1);
} else {
  run();
}
