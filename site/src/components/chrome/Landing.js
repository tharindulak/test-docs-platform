// The Landing deployment's page: a search-first hero, 4-6 start paths, and
// every product, drawn from the same Platform navigation as the products menu
// (lib/switching.mjs landingGroups): the families, then Solutions and Other,
// in the same order with the same entries, adding only each group's short
// description and each entry's Cloud and Self-hosted links.
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
          <div className="container">
            <h1 className="wso2-hero__title">{content.hero.title}</h1>
            <p className="wso2-hero__text">{content.hero.text}</p>
            <SearchBox variant="hero" />
          </div>
        </section>
        <section className="container wso2-landing__section" aria-labelledby="start-paths">
          <h2 id="start-paths">{content.startPathsTitle}</h2>
          <ul className="wso2-start-paths">
            {content.startPaths.map((s) => (
              <li key={s.href}>
                <a className="wso2-card wso2-card--link" href={s.href}>
                  <span className="wso2-card__title">{s.title}</span>
                  <span className="wso2-card__text">{s.description}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
        <section className="container wso2-landing__section" aria-labelledby="catalog">
          <h2 id="catalog">{content.catalogTitle}</h2>
          {landingGroups(manifest).map((g) => (
            <section className="wso2-family" key={g.id} aria-labelledby={`family-${g.id}`} data-group={g.id}>
              <h3 className="wso2-family__title" id={`family-${g.id}`}>{g.name}</h3>
              {g.description && <p className="wso2-family__text">{g.description}</p>}
              <ul className="wso2-catalog">
                {g.entries.map((e) => (
                  <li className="wso2-card" key={`${e.href}|${e.label}`} data-kind={e.kind} data-docspace={e.docSpace ?? undefined}>
                    <a className="wso2-card__title" href={e.href} onClick={remember(e)}>
                      {e.label}{e.external && <><span className="wso2-external" aria-hidden="true"> ↗</span><span className="wso2-sr-only">{e.linksOut ? ' (external site)' : ' (not on WSO2 Docs yet: its old site)'}</span></>}
                    </a>
                    {e.editions.length > 0 && (
                      <ul className="wso2-kinds" aria-label={`${e.label} editions`}>
                        {e.editions.map((k) => <li key={k.label}><a className="wso2-kind" href={k.href} onClick={remember(e)}>{k.label}</a></li>)}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </section>
      </main>
    </Layout>
  );
}
