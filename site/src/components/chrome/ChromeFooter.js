// The Platform footer, from chrome.json (runtime copy over the baked snapshot):
// WSO2's logo, then one column per footer.columns entry, then the copyright
// and legal links. The logo's images are the shared theme's (plugins/theme.mjs).
import React from 'react';
import { copyrightText } from '../../../../lib/chrome.mjs';
import { useChrome, usePlatform } from './runtime';

export default function ChromeFooter() {
  const footer = useChrome().footer ?? {};
  const { themeBase } = usePlatform();
  const mark = `${themeBase}img/pulse-mark.svg`;
  const markDark = `${themeBase}img/pulse-mark-white.svg`;
  return (
    <footer className="wso2-footer" data-wso2-chrome="">
      <div className="wso2-footer__inner">
        <a href="https://wso2.com/" className="wso2-footer__logo">
          <img className="wso2-site-bar__mark wso2-site-bar__mark--light" src={mark} alt="" width="24" height="24" />
          <img className="wso2-site-bar__mark wso2-site-bar__mark--dark" src={markDark} alt="" width="24" height="24" />
          <span>WSO2</span>
        </a>
        {(footer.columns ?? []).map((col) => (
          <nav className="wso2-footer__col" aria-label={col.title} key={col.title}>
            <p className="wso2-footer__title">{col.title}</p>
            <ul>{col.links.map((l) => <li key={l.href}><a href={l.href}>{l.label}</a></li>)}</ul>
          </nav>
        ))}
      </div>
      <div className="wso2-footer__bottom">
        <p>{copyrightText(footer.copyright)}</p>
        <ul aria-label="Legal">{(footer.legal ?? []).map((l) => <li key={l.href}><a href={l.href}>{l.label}</a></li>)}</ul>
      </div>
    </footer>
  );
}
