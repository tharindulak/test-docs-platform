// "WSO2 Docs" logo and name, linking to the Landing deployment at the site
// root. A navbar item rather than navbar.logo, because Docusaurus prefixes the
// logo link with this deployment's baseUrl.
import React from 'react';
import useBaseUrl from '@docusaurus/useBaseUrl';

export default function Brand({ mobile }) {
  const logo = useBaseUrl('/img/wso2-docs-mark.svg');
  if (mobile) {
    return <li className="menu__list-item"><a className="menu__link" href="/">WSO2 Docs home</a></li>;
  }
  return (
    <a className="navbar__brand wso2-brand" href="/">
      <img className="navbar__logo wso2-brand__mark" src={logo} alt="" width="28" height="28" />
      <b className="navbar__title">WSO2 Docs</b>
    </a>
  );
}
