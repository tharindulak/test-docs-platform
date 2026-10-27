// Safe swizzle (eject; Docusaurus marks NavbarItem/ComponentTypes "safe"): the
// Platform header widgets as custom navbar item types. The stock Navbar is
// not ejected.
import ComponentTypes from '@theme-original/NavbarItem/ComponentTypes';
import Brand from '@site/src/components/chrome/Brand';
import ProductSwitcher from '@site/src/components/chrome/ProductSwitcher';
import EditionDropdown from '@site/src/components/chrome/EditionDropdown';
import SiteLinks from '@site/src/components/chrome/SiteLinks';

export default {
  ...ComponentTypes,
  'custom-wso2Brand': Brand,
  'custom-wso2ProductSwitcher': ProductSwitcher,
  'custom-wso2EditionDropdown': EditionDropdown,
  'custom-wso2SiteLinks': SiteLinks,
};
