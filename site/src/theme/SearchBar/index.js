// Safe swizzle (eject): the header search slot. The navbar's `search` item
// renders this; the search task fills SearchBox.
import React from 'react';
import SearchBox from '@site/src/components/chrome/SearchBox';

export default function SearchBar() {
  return <SearchBox variant="header" />;
}
