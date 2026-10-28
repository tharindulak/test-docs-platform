---
sidebar_position: 2
title: Build an automation
sidebar_label: Automation Quick Start
description: Build an automation that prints Hello World when it runs.
keywords: [automation, quick start]
slug: /get-started/quickstarts/build-automation
wide_layout: true
---

import ThemedImage from '@theme/ThemedImage';
import useBaseUrl from '@docusaurus/useBaseUrl';
import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Build an automation

<QuickstartHeader
  time="Under 10 minutes"
  build={<>An automation that prints <code>Hello World</code> when it runs.</>}
/>

<Prerequisites>

## Prerequisites

<PrereqCard icon="local" title="Local setup" href="/get-started">
  Install and launch WSO2 Integrator on your machine.
</PrereqCard>
<PrereqCard icon="cloud" title="WSO2 Cloud account" href="/get-started/sign-up" cloud>
  For AI-assisted development.
</PrereqCard>

</Prerequisites>

<Steps>

## Step 1: Create the integration {#create}

1. Open WSO2 Integrator.

2. Click **Create**.

   <ThemedImage
      alt="The home screen with the Create card"
      sources={{
         light: useBaseUrl('/img/flow-light.png'),
         dark: useBaseUrl('/img/flow-dark.png'),
      }}
   />

## Step 2: Run it

<Tabs>
<TabItem value="ui" label="Visual designer" default>

Click **Run**. Deploy it from the <CloudDocsLink to="/manage/integrations">Cloud console</CloudDocsLink>.

</TabItem>
<TabItem value="code" label="Code">

```ballerina
public function main() {
    io:println("Hello World");
}
```

</TabItem>
</Tabs>

</Steps>

See [patterns](../develop/patterns/message-filter.md#how-it-works), the [control plane](../icp/start.md) and the [HTTP connector](product://connectors/catalog/http).
