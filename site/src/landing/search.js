// docs.wso2.com/search/?q=…&scope=…: the full search results page, where
// "See all results" in every Docs deployment's search pop-up leads.
import React from 'react';
import Layout from '@theme/Layout';
import SearchPage from '@site/src/components/search/SearchPage';

export default function Search() {
  return (
    <Layout title="Search" description="Search all of WSO2 Docs">
      <SearchPage />
    </Layout>
  );
}
