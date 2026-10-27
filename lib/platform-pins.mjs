// The Platform major each Content repo pins (Platform releases): its
// `.github/workflows/docs.yml` checks the Platform out at `PLATFORM_REF: v<n>`
// and calls its reusable workflows at `@v<n>`. A Platform release rebuilds
// only the Docs deployments whose Content repo pins its major, so the plan
// reads the pin from each repo's main line, the checkouts compose already
// reads (scripts/clone-content-repos.mjs). The pin lives only there: nothing
// else records it, so a repo that moves to `v2` is rebuilt by the next `2.x.y`
// release whether or not it has made a Docs release since.
import fs from 'node:fs';
import path from 'node:path';

const REF = /^\s*PLATFORM_REF:\s*['"]?v(\d+)['"]?\s*(?:#.*)?$/m;
const USES = /wso2\/docs-platform\/\.github\/workflows\/[^@\s]+@v(\d+)\b/g;

const lower = (s) => String(s ?? '').toLowerCase();

// The Platform repo, as navigation.yaml names it in the composed manifest.
export const platformRepoOf = (policy) => policy?.sources?.navigation?.data?.platformRepo ?? 'wso2/docs-platform';

// The major a Content repo checkout pins, or null: `PLATFORM_REF: v<n>` in
// docs.yml, else the one `@v<n>` its workflows call the Platform's reusable
// workflows at. A branch, a commit or two different majors pin no major.
export function readPlatformPin(checkout) {
  const dir = path.join(checkout, '.github', 'workflows');
  const docs = path.join(dir, 'docs.yml');
  if (fs.existsSync(docs)) {
    const m = REF.exec(fs.readFileSync(docs, 'utf8'));
    if (m) return Number(m[1]);
  }
  if (!fs.existsSync(dir)) return null;
  const majors = new Set();
  for (const f of fs.readdirSync(dir).filter((f) => /\.ya?ml$/.test(f))) {
    for (const m of fs.readFileSync(path.join(dir, f), 'utf8').matchAll(USES)) majors.add(Number(m[1]));
  }
  return majors.size === 1 ? [...majors][0] : null;
}

// { '<owner/name>' (lower case): major | null } for every Content repo with a
// Doc space on WSO2 Docs, from checkouts named as the repos under contentDir.
// The Platform repo is left out: its Doc spaces (Contribute) always build with
// the Platform that runs.
export function readPlatformPins(policy, contentDir) {
  const platform = lower(platformRepoOf(policy));
  const pins = {};
  for (const s of Object.values(policy.docSpaces ?? {})) {
    if (s.status === 'legacy' || !s.repo || lower(s.repo) === platform || lower(s.repo) in pins) continue;
    pins[lower(s.repo)] = readPlatformPin(path.join(contentDir, s.repo.split('/').pop()));
  }
  return pins;
}
