// "Docs" at the left of the docs bar, linking to the Landing deployment at the
// site root (the wso2.com bar's logo goes to wso2.com). A navbar item rather
// than navbar.logo, because Docusaurus prefixes the logo link with this
// deployment's baseUrl.
import React from 'react';

export default function Brand({ mobile }) {
  if (mobile) {
    return <li className="menu__list-item"><a className="menu__link" href="/">WSO2 Docs home</a></li>;
  }
  return (
    <a className="navbar__brand wso2-brand" href="/" aria-label="WSO2 Docs home">
      <span className="wso2-brand__text">Docs</span>
    </a>
  );
}
