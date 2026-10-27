// The preview build of the affected Edition (strict: broken links, anchors
// and images fail) and the Markdown twin checks on its output.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeRoute } from './content.mjs';
import { cloudPartOf } from '../cloud-tree.mjs';
import { checkMarkdownTwins } from '../twin-checks.mjs';
import { pageOfTwin } from '../twin-paths.mjs';

const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'wso2-docs.mjs');

// Docusaurus prints "Broken link on source page path = /a/b/:" then "-> linking to ...".
const SITE_DIR = path.join(path.dirname(cli), '..', 'site');
const MD_REF = /Markdown (link|image) with URL `([^`]+)` in source file "([^"]+)" \((\d+):(\d+)\) couldn't be resolved/;
const NOISE = /Unable to build website for locale|Markdown twins:|broken links!|broken anchors!|Client bundle compiled with errors|MDX compilation failed for file/i;

function buildFindings(output, routes, baseUrl, root) {
  const fileFor = (pagePath) => {
    const rel = pagePath.startsWith(baseUrl) ? pagePath.slice(baseUrl.length) : pagePath;
    return routes.get(normalizeRoute(rel))?.file ?? null;
  };
  const findings = [];
  let page = null;
  let twins = false;
  for (const raw of output.split('\n')) {
    const line = raw.replace(/\x1b\[[0-9;]*m/g, '').trim();
    // The build's own Markdown twin check (plugins/markdown-export.mjs) can fail first.
    if (/Markdown twins:$/.test(line)) {
      twins = true;
      continue;
    }
    const twin = twins ? /^(\S+\.(?:md|txt)): (.+)$/.exec(line) : null;
    if (twin) {
      const route = twin[1].endsWith('.md') ? pageOfTwin(twin[1]) : null;
      findings.push({ level: 'error', file: (route !== null && routes.get(normalizeRoute(route))?.file) || twin[1], line: 1, message: `Markdown twin ${twin[1]}: ${twin[2]}` });
      continue;
    }
    twins &&= !/^at /.test(line);
    const src = /source page path = (\S+?):?$/.exec(line);
    if (src) {
      page = src[1];
      continue;
    }
    const link = /^-> linking to (.+)$/.exec(line);
    if (link && page) {
      findings.push({ level: 'error', file: fileFor(page) ?? page, line: 1, message: `Broken link or anchor: ${link[1]}` });
      continue;
    }
    const ref = MD_REF.exec(line);
    if (ref) {
      const file = path.relative(root, path.resolve(SITE_DIR, ref[3])).split(path.sep).join('/');
      findings.push({ level: 'error', file, line: Number(ref[4]), column: Number(ref[5]), message: `Broken ${ref[1]}: ${ref[2]} doesn't resolve to a ${ref[1] === 'image' ? 'file' : 'page'}.` });
      continue;
    }
    if (/^\[ERROR\]|^Error:/i.test(line) && !NOISE.test(line)) {
      findings.push({ level: 'error', file: null, line: 1, message: line.replace(/^\[ERROR\]\s*/, '') });
    }
  }
  const seen = new Set();
  return findings.filter((x) => {
    const key = `${x.file}|${x.line}|${x.message}`;
    return !seen.has(key) && seen.add(key);
  });
}

export function previewBuild(ctx, { editionId, out, baseUrl, linkHost, manifest, verbose = false, routes }) {
  const args = [cli, 'build', ctx.root, '--edition', editionId, '--out', out];
  if (baseUrl) args.push('--base-url', baseUrl);
  if (linkHost) args.push('--link-host', linkHost);
  if (manifest) args.push('--manifest', manifest);
  const started = Date.now();
  const r = spawnSync(process.execPath, args, { cwd: SITE_DIR, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  const output = `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
  if (verbose) process.stderr.write(output);
  const seconds = Math.round((Date.now() - started) / 1000);
  if (r.status === 0) return { findings: [], note: `built in ${seconds}s`, ok: true };
  const platform = editionId === 'cloud' ? cloudPartOf(ctx.repo.docspace) : null;
  const effectiveBase = baseUrl ?? (platform ? `/${platform}/cloud/${ctx.repo.docspace.slug}/` : `/${ctx.repo.docspace.slug}/${editionId === '_' ? '' : `${editionId}/`}`);
  const findings = buildFindings(output, routes, effectiveBase, ctx.root);
  if (!findings.length) {
    const tail = output.split('\n').map((l) => l.trim()).filter(Boolean).slice(-8).join(' | ');
    findings.push({ level: 'error', file: null, line: 1, message: `The build failed: ${tail}` });
  }
  return { findings, note: `failed after ${seconds}s`, ok: false };
}

// Markdown twins (AI/LLM-friendly docs): the Platform's own twin checks
// (lib/twin-checks.mjs), which the build and the release pipeline also run.
export function checkTwins(dir, { siteUrl } = {}) {
  if (!fs.existsSync(path.join(dir, '_platform', 'markdown.json'))) return { findings: [], note: 'the build has no Markdown twins' };
  const problems = checkMarkdownTwins(dir, siteUrl ? { siteUrl } : {});
  const count = JSON.parse(fs.readFileSync(path.join(dir, '_platform', 'markdown.json'), 'utf8')).files.length;
  return {
    findings: problems.map((p) => ({ level: 'error', file: p.file, line: Number(/on line (\d+)/.exec(p.message)?.[1] ?? 1), message: `Markdown twin: ${p.message}` })),
    note: `${count} twins`,
  };
}
