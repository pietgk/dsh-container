# Browser and visual evaluation runbook

## Connection order

1. Confirm the manager reports the instance ready and the loopback URL responds.
2. Ask the official browser runtime to select the target URL.
3. If unavailable, connect an in-app Browser or install and enable the ChatGPT
   browser extension through **Settings -> Computer use**, then retry once.
4. If neither official path is connected, report interactive evidence as
   blocked. Continue functional or Playwright work only under its own evidence
   label.
5. A separately approved Chrome DevTools session may collect diagnostic
   screenshots, console messages, accessibility state, and network evidence.

## Repository-owned visual gate

Install the pinned browser and run against a controlled live instance:

```text
pnpm exec playwright install chromium
DSH_E2E_BASE_URL=http://127.0.0.1:30081 pnpm e2e
```

To inspect a known controlled transcript, also set
`DSH_E2E_SESSION_TITLE`. The default suite is read-only. It checks the shell,
configured credential indicator, persisted transcript, representative desktop
viewports, reload behavior, and fatal console errors.

The opt-in live-model scenario mutates the selected session and consumes model
tokens. It never configures or reads a key:

```text
DSH_E2E_SESSION_TITLE="controlled session" pnpm e2e:live
```

Screenshot baselines must be produced with the pinned Playwright Chromium.
Update them only after reviewing the actual rendered change.
