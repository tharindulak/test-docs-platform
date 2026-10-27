// robots.txt, answered by the Edge Worker for the whole host (SEO and
// canonical strategy, amended by AI/LLM-friendly docs, decision 6):
//   staging (NOINDEX_ALL): every crawler is disallowed;
//   production: everything is allowed, AI crawlers included, unless the
//   AI_CRAWLERS var is "disallow" (WSO2's training-use policy is still open
//   with the owners; flipping the var needs no rebuild).

// Named explicitly so the policy reads plainly and flips in one place.
export const AI_CRAWLERS = [
  'GPTBot', 'OAI-SearchBot', 'ChatGPT-User',
  'ClaudeBot', 'Claude-SearchBot', 'Claude-User',
  'Google-Extended', 'Applebot-Extended',
  'PerplexityBot', 'Perplexity-User',
  'CCBot', 'meta-externalagent', 'Amazonbot',
];

const truthy = (v) => v === true || v === 'true' || v === '1';

export function robotsTxt(env) {
  if (truthy(env.NOINDEX_ALL)) return 'User-agent: *\nDisallow: /\n';
  const ai = env.AI_CRAWLERS === 'disallow' ? 'Disallow: /' : 'Allow: /';
  return [
    '# WSO2 Docs',
    'User-agent: *',
    'Allow: /',
    '',
    `# AI crawlers (AI/LLM-friendly docs): ${env.AI_CRAWLERS === 'disallow' ? 'disallowed' : 'allowed'}`,
    ...AI_CRAWLERS.map((ua) => `User-agent: ${ua}`),
    ai,
    '',
    `Sitemap: https://${env.DOCS_HOST ?? 'docs.wso2.com'}/sitemap.xml`,
    '',
  ].join('\n');
}
