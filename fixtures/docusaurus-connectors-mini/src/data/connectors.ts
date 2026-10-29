/**
 * Catalog data, as the Connectors site keeps it (read by the converter
 * without running it).
 */
export interface Connector {
  name: string;
  description: string;
  link: string;
  category: string;
  vendor?: string;
  icon?: string;
}

export const CATEGORIES: string[] = [
    "Communication",
    "CRM & Sales",
];

export const CONNECTORS: Connector[] = [
    { name: "Salesforce", description: "Manage Salesforce records, queries and events", link: "crm-sales/salesforce/overview", category: "CRM & Sales", vendor: "Salesforce", icon: "https://bcentral-packageicons.azureedge.net/images/ballerinax_salesforce_8.0.0.png" },
    { name: "Twilio", description: "Send SMS and voice messages", link: "communication/twilio", category: "Communication", vendor: "Twilio" },
    // A connector whose page is gone: left out of the catalog.
    { name: "Gone", description: "No page", link: "crm-sales/gone/overview", category: "CRM & Sales" },
];
