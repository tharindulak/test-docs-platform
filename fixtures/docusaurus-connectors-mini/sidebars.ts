import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';
import { connectorVersionedDocs } from './src/utils/sidebarUtils';

// The Connectors site's sidebar, as on its branch: a hand-kept catalog with
// a spread (code) that hides a versioned connector's older pages.
const sidebars: SidebarsConfig = {
  mainSidebar: [
    {
      type: 'category',
      label: 'Connector Catalog',
      className: 'catalog-pinned-row',
      customProps: { badge: '2', collapseOwnPage: true },
      link: { type: 'doc', id: 'catalog/index' },
      items: [
        {
          type: 'category',
          label: 'Salesforce',
          link: { type: 'doc', id: 'catalog/crm-sales/salesforce/overview' },
          items: [
            'catalog/crm-sales/salesforce/setup-guide',
            'catalog/crm-sales/salesforce/actions',
          ],
        },
        {
          type: 'category',
          label: 'Twilio',
          link: { type: 'doc', id: 'catalog/communication/twilio/twilio' },
          items: [
            'catalog/communication/twilio/actions',
            ...connectorVersionedDocs('connectors/catalog/communication/twilio'),
          ],
        },
      ],
    },
    { type: 'doc', id: 'overview', label: 'Overview' },
    { type: 'doc', id: 'using-connectors', label: 'Using Connectors' },
    {
      type: 'category',
      label: 'Reference',
      items: ['reference/faq'],
    },
  ],
};

export default sidebars;
