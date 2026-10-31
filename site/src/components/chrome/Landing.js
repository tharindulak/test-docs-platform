// The Landing deployment's page: a navy, search-first hero with popular links
// under the search box, every product in one catalogue drawn from the same
// Platform navigation as the products menu (lib/switching.mjs landingGroups):
// the families, then Solutions and Other, in the same order with the same
// entries, each one link to where the menu opens it. Then the Learn and
// Community columns from chrome/landing.yaml. The page has the wso2.com bar
// but no docs bar (chrome.css).
import React, { useEffect } from 'react';
import Layout from '@theme/Layout';
import { landingGroups } from '../../../../lib/switching.mjs';
import SearchBox from './SearchBox';
import { useManifest, usePlatform, writeSection } from './runtime';
import { trackPageView } from './analytics';

const remember = (e) => () => { if (e.section && e.docSpace) writeSection(e.docSpace, e.section); };

export default function Landing() {
  const { landingContent: content } = usePlatform();
  const manifest = useManifest();
  useEffect(() => { trackPageView('landing'); }, []);
  return (
    <Layout description={content.hero.text}>
      <main className="wso2-landing">
        <section className="wso2-hero">
          <h1 className="wso2-hero__title">{content.hero.title}</h1>
          <p className="wso2-hero__text">{content.hero.text}</p>
          <SearchBox variant="hero" />
          <nav className="wso2-popular" aria-labelledby="popular">
            <span id="popular" className="wso2-popular__label">{content.popularTitle}:</span>
            <ul>{content.popular.map((p) => <li key={p.href}><a href={p.href}>{p.title}</a></li>)}</ul>
          </nav>
        </section>
        <section className="wso2-catalog" aria-labelledby="catalog">
          <h2 id="catalog" className="wso2-sr-only">{content.catalogTitle}</h2>
          {landingGroups(manifest).map((g) => (
            <section className="wso2-family" key={g.id} aria-labelledby={`family-${g.id}`} data-group={g.id}>
              <h3 className="wso2-family__title" id={`family-${g.id}`}>{g.name}</h3>
              <ul>
                {g.entries.map((e) => (
                  <li key={`${e.href}|${e.label}`} data-kind={e.kind} data-docspace={e.docSpace ?? undefined}>
                    <a href={e.href} onClick={remember(e)}>
                      {e.label}{e.external && <><span className="wso2-external" aria-hidden="true"> ↗</span><span className="wso2-sr-only">{e.linksOut ? ' (external site)' : ' (not on WSO2 Docs yet: its old site)'}</span></>}
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </section>
        <div className="wso2-landing__columns">
          {content.columns.map((c, i) => (
            <section className="wso2-family" key={c.title} aria-labelledby={`column-${i}`}>
              <h2 className="wso2-family__title" id={`column-${i}`}>{c.title}</h2>
              <ul>{c.links.map((l) => <li key={l.href}><a href={l.href}>{l.label}</a></li>)}</ul>
            </section>
          ))}
        </div>
      </main>
    </Layout>
  );
}
