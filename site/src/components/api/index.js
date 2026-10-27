// Components for `layout: api-reference` pages. The remark step
// (plugins/remark-api-reference.mjs) generates the page from the spec and
// wraps it in these; they only add structure and styling, so everything is
// in the server-rendered HTML and nothing is interactive beyond <details>.
import React, { createContext, useContext, useState } from 'react';
import Link from '@docusaurus/Link';
import useBaseUrl from '@docusaurus/useBaseUrl';
import { HtmlClassNameProvider } from '@docusaurus/theme-common';

const ApiContext = createContext({});

export function ApiReference({ backHref, backLabel, children }) {
  return (
    <HtmlClassNameProvider className="wso2-api-page">
      <ApiContext.Provider value={{ backHref, backLabel }}>
        <div className="wso2-api">{children}</div>
      </ApiContext.Provider>
    </HtmlClassNameProvider>
  );
}

export function ApiNav({ children }) {
  const { backHref, backLabel } = useContext(ApiContext);
  return (
    <nav className="wso2-api__nav" aria-label="API contents" data-search-exclude="">
      <div className="wso2-api__nav-inner">
        <Link className="wso2-api__back" to={backHref}>← {backLabel}</Link>
        {children}
      </div>
    </nav>
  );
}

export function ApiContent({ children }) {
  return <div className="wso2-api__content">{children}</div>;
}

export function ApiHeader({ version, server, specHref }) {
  const href = useBaseUrl(specHref);
  return (
    <div className="wso2-api__header">
      <a className="button button--primary wso2-api__download" href={href} download="openapi.yaml">Download OpenAPI (YAML)</a>
      {version && <span className="wso2-api__version">Version {version}</span>}
      {server && <p className="wso2-api__server">Base URL: <code>{server}</code></p>}
    </div>
  );
}

export function ApiTag({ children }) {
  return <section className="wso2-api-tag">{children}</section>;
}

export function ApiOperation({ method, children }) {
  return <section className={`wso2-api-op wso2-api-op--${method}`}>{children}</section>;
}

export function ApiOperationMain({ children }) {
  return <div className="wso2-api-op__main">{children}</div>;
}

export function ApiSamples({ children }) {
  return <aside className="wso2-api-op__samples" aria-label="Request and response samples">{children}</aside>;
}

export function ApiMethod({ method }) {
  return <span className={`wso2-api-method wso2-api-method--${method}`}>{method === 'delete' ? 'DEL' : method.toUpperCase()}</span>;
}

export function ApiEndpoint({ method, path, deprecated }) {
  return (
    <p className="wso2-api-endpoint">
      <ApiMethod method={method} /> <code>{path}</code>
      {deprecated !== undefined && <span className="wso2-api-endpoint__deprecated">Deprecated</span>}
    </p>
  );
}

// Native <details>: the content stays in the HTML for search engines and search records.
export function ApiDetails({ summary, open, children }) {
  return (
    <details className="wso2-api-details" open={open !== undefined}>
      <summary>{summary}</summary>
      <div className="wso2-api-details__body">{children}</div>
    </details>
  );
}

// A sample without per-token highlighting: Prism's spans made samples about 15
// times their text size, most of a large API page. Copy works as on code blocks.
export function ApiCode({ title, lang, code }) {
  const [copied, setCopied] = useState(false);
  const copy = () => navigator.clipboard?.writeText(code).then(() => {
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  });
  return (
    <figure className="wso2-api-code">
      <figcaption className="wso2-api-code__title">
        <span>{title}</span>
        <button type="button" className="wso2-api-code__copy" onClick={copy} aria-label={`Copy ${title}`}>{copied ? 'Copied' : 'Copy'}</button>
      </figcaption>
      <pre className={`wso2-api-code__pre language-${lang}`}><code>{code}</code></pre>
    </figure>
  );
}

export function ApiSchema({ children }) {
  return <div className="wso2-api-schema">{children}</div>;
}

export default {
  ApiReference, ApiNav, ApiContent, ApiHeader, ApiTag, ApiOperation, ApiOperationMain, ApiSamples, ApiMethod, ApiEndpoint, ApiDetails, ApiSchema, ApiCode,
};
