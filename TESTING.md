# Testing

US Systems Lab is tested as a static browser application (the Block Board) and as a deterministic directed-graph model.

## Supported local release environment

The deployment release target is:

- Node.js 24.18.0
- npm 10.9.2

The repository pins the Node version in `.nvmrc` and locks JavaScript dependencies in `package-lock.json`.

## Clean install

Start from a clean checkout or clean staged release candidate:

```sh
npm ci
```

Do not replace the lockfile during routine verification.

## Full verification

Run the complete repository verification gate:

```sh
npm run verify
```

This covers linting, TypeScript checks, formatting, unit and repository-contract tests, tracked coverage, the production build, Python script tests, repository text hygiene, and the independent numerical audit (`npm run test:math`).

## Production browser verification

The deeper browser harness requires Google Chrome or Chromium:

```sh
npm run test:e2e
```

The browser test builds the production bundle and drives the Block Board in real Chrome. For all 20 indicators at both signed extremes, and at 1440, 390 and 320 pixel widths, it compares every tile's rendered square count with independent arithmetic (`scripts/block-oracle.mjs`). It also checks multi-input composition, source links, scenario URL reload and normalization, reset, browser history, keyboard, pointer and touch input, reduced motion, and that a deliberately broken downstream tile makes the suite fail.

## Independent numerical checks

`npm run test:math` checks the production propagation/effects functions against a separately
implemented exact-rational path enumeration. It covers 420 single-input grid scenarios,
760 signed pairs, and 500 deterministic multi-input scenarios (1,680 scenarios and 33,600
indicator comparisons). It checks raw and clamped results, whole-block rounding, displayed
direction and color (including cancellation roundoff), input-order
independence, and a deliberately reversed propagation sign in a temporary compiled copy.
No production model source is mutated. Set `USL_MATH_ARTIFACTS` to an external directory
for its machine-readable report.

The browser suite additionally exercises all 420 single-input grid positions at desktop
width, beyond its 120 signed viewport cases. It checks the actual automatic bar width,
marker position, color, accessible meter value, and squares against the exact-rational oracle.
Frozen automatic bars and incorrect colors must fail the same verifier. An open share field
must update when browser history returns to a neutral scenario. The expected source build
identifier must match the page being tested.

These checks establish implementation consistency with editorial assumptions, not empirical
causal validity. The 100 percent coverage threshold applies to the configured core and pure
helper scope, not every DOM-renderer line; component and browser checks cover the active UI.

## What changes require additional evidence

Data changes should keep source URLs, retrieval dates, value type, units, and as-of information consistent.

Model changes should preserve directed semantics. A relationship must not be treated as reversible unless a separate reverse edge is explicitly defined. Modeled and empirical relationships must remain distinguishable.

Changes to URL encoding, propagation, the block display, deployment configuration, dependency policy, or browser behavior should include regression coverage for the changed contract.

## Before opening a pull request

Run the relevant focused tests while developing, then run:

```sh
npm run verify
npm run test:e2e
npm audit --audit-level=low
```

Do not include generated build output, credentials, local machine paths, private logs, or unrelated artifacts in the pull request.

## Verification layers and limits

`npm run verify` is the deterministic source and repository gate. It covers linting, type checks, formatting, unit and repository-contract tests, tracked coverage, the production build, Python script tests, text hygiene, and the independent numerical audit. It does not launch a browser.

`npm run test:e2e` is the production-browser layer. CI runs the same deterministic component checks as `npm run verify`, then the browser E2E gate and `npm audit --audit-level=low` under Node.js 24.18.0 and npm 10.9.2.

Run `npm run check:sources` only when an operator intentionally wants the best-effort external source reachability report. It needs network access and is not part of `npm run verify` or CI. It treats only HTTP 2xx and 3xx responses as reachable. Network failures and HTTP 4xx or 5xx responses are reported as unsuccessful reachability, but the report is diagnostic: it does not establish source validity, factual correctness, or currency, and it is not a substitute for reviewing the cited primary source.

The browser harness checks the keyboard path and accessible names used by the application. No automated axe/WCAG conformance scan is currently part of the repository gate, so these tests must not be treated as a complete accessibility certification.

## Rapid input and address-bar synchronization

The blocks, automatic response meters, counts, and Share field update immediately.
Only address-bar writes are coalesced: the latest scenario is written no more than
once every 400 milliseconds while inputs change rapidly. Reset replaces queued
input with the neutral scenario. Loading browser history and unmounting cancel
older queued work. A rejected or silently ignored History API write is reported
and retried a bounded number of times; Share continues to use the current model.

The browser test waits for the actual canonical URL rather than a fixed delay.
It checks all 20 reset inputs, the neutral response, disabled Reset state, cleared
notices, and empty query. A separate 250-event native-keyboard burst is intentionally
unpaced: the renderer must remain immediate and the final reset URL must stay clear.
Browser navigation-throttling warnings fail the run. The URL scheduler is included
in the existing 100 percent helper coverage gate. Browser protections are not disabled.

Two browser checks queue a write inside a single browser task, assert that the write is
pending, and then require an immediate Reset and a history navigation to a neutral scenario
to win over it. A last input made within about 400 milliseconds of closing or reloading the
tab may not reach the address bar; Share always shows the current scenario.
