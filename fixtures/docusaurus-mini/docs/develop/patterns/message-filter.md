---
title: Message filter
description: Drop messages that do not match a condition.
slug: /develop/patterns/message-filter
---

import TabAwareToc from '@site/src/components/TabAwareToc';
import {
  EipReferenceLink,
  PatternImplementationTabs,
  PatternImage,
} from '@site/src/utils/eipPatternComponents';
import TabItem from '@theme/TabItem';

# Message filter

Use a message filter to drop unwanted messages. <EipReferenceLink href="https://www.enterpriseintegrationpatterns.com/patterns/messaging/Filter.html" label="Message Filter reference" />

## How it works

<TabAwareToc />

<PatternImplementationTabs>
<TabItem value="ui" label="Visual Designer" default>

1. Add an **If** node.

<PatternImage
  src="/img/develop/pattern.png"
  alt="Message Filter flow"
  width={560}
/>

</TabItem>
<TabItem value="code" label="Ballerina Code">

```ballerina
if message.priority == HIGH {
    check forward(message);
}
```

</TabItem>
</PatternImplementationTabs>
