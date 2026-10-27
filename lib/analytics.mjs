// Page analytics (Analytics and feedback): WSO2's GTM container behind the
// CookiePro consent banner, plus the Platform's fixed dataLayer events.
// Pure: the config builds the head script and the browser pushes the events.

export const GTM_ID = 'GTM-PSTXMT';
export const COOKIEPRO_DOMAIN_SCRIPT = '486163bc-a8c5-40d8-b185-c707cc718a23'; // wso2.com

// Every event carries docSpace, edition and pageType. Other Platform pieces
// (search, "Copy page") push theirs through the same names.
export const EVENTS = {
  pageView: 'docs_page_view',
  editionSwitch: 'docs_edition_switch', // from, to, result: same|renamed|home|legacy
  search: 'docs_search', // query, scope, results
  copyPage: 'docs_copy_page',
  openInAi: 'docs_open_in_ai', // target
  feedback: 'docs_feedback', // vote, reason
  notFound: 'docs_404', // path, referrer
};

// One inline head script. Release builds are promoted byte for byte from
// staging to production, so the script loads CookiePro and GTM only on the
// production host(s): staging and previews load nothing. CookiePro is inserted
// first, and both scripts are non-async, so CookiePro runs before GTM and can
// block tags until the reader consents.
export function analyticsHeadScript({ hosts, gtmId = GTM_ID, cookiePro = COOKIEPRO_DOMAIN_SCRIPT }) {
  return `(function(w,d){if(${JSON.stringify(hosts)}.indexOf(w.location.hostname)<0)return;`
    + `w.OptanonWrapper=function(){};w.dataLayer=w.dataLayer||[];w.dataLayer.push({'gtm.start':new Date().getTime(),event:'gtm.js'});`
    + `function add(src,attrs){var s=d.createElement('script');s.src=src;s.async=false;s.charset='UTF-8';for(var k in attrs)s.setAttribute(k,attrs[k]);d.head.appendChild(s);}`
    + `add('https://cookie-cdn.cookiepro.com/scripttemplates/otSDKStub.js',{'data-domain-script':${JSON.stringify(cookiePro)}});`
    + `add('https://www.googletagmanager.com/gtm.js?id=${gtmId}',{});`
    + `})(window,document);`;
}
