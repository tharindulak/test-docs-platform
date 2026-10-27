// The Platform footer, from chrome.json (runtime copy over the baked snapshot).
import React from 'react';
import { copyrightText } from '../../../../lib/chrome.mjs';
import { useChrome } from './runtime';

export default function ChromeFooter() {
  const footer = useChrome().footer ?? {};
  return (
    <footer className="wso2-footer" data-wso2-chrome="">
      <div className="container wso2-footer__inner">
        <div className="wso2-footer__brand">
          <a href="/" className="wso2-footer__home">WSO2 Docs</a>
          <p className="wso2-footer__tagline">Documentation for every WSO2 product.</p>
        </div>
        {(footer.columns ?? []).map((col) => (
          <nav className="wso2-footer__col" aria-label={col.title} key={col.title}>
            <p className="wso2-footer__title">{col.title}</p>
            <ul>{col.links.map((l) => <li key={l.href}><a href={l.href}>{l.label}</a></li>)}</ul>
          </nav>
        ))}
      </div>
      <div className="container wso2-footer__bottom">
        <p>{copyrightText(footer.copyright)}</p>
        <ul aria-label="Legal">{(footer.legal ?? []).map((l) => <li key={l.href}><a href={l.href}>{l.label}</a></li>)}</ul>
      </div>
    </footer>
  );
}
