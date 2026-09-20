# Testing

US Systems Lab is tested as a static browser application and as a deterministic directed-graph model.

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

This covers linting, TypeScript checks, formatting, unit and repository-contract tests, tracked coverage, the production build, Python script tests, and repository text hygiene.

## Production browser verification

The deeper browser harness requires Google Chrome or Chromium:

```sh
npm run test:e2e
```

The browser test builds the production bundle and exercises graph rendering, all node sliders in both directions, scenario URL state, reset behavior, keyboard interaction, zoom behavior, mobile layout, and browser exception checks.

## What changes require additional evidence

Data changes should keep source URLs, retrieval dates, value type, units, and as-of information consistent.

Model changes should preserve directed semantics. A relationship must not be treated as reversible unless a separate reverse edge is explicitly defined. Modeled and empirical relationships must remain distinguishable.

Changes to URL encoding, propagation, graph layout, deployment configuration, dependency policy, or browser behavior should include regression coverage for the changed contract.

## Before opening a pull request

Run the relevant focused tests while developing, then run:

```sh
npm run verify
npm run test:e2e
npm audit --audit-level=low
```

Do not include generated build output, credentials, local machine paths, private logs, or unrelated artifacts in the pull request.

## Verification layers and limits

`npm run verify` is the deterministic source and repository gate. It covers linting, type checks, formatting, unit and repository-contract tests, tracked coverage, the production build, Python script tests, and text hygiene. It does not launch a browser.

`npm run test:e2e` is the production-browser layer. CI runs the same deterministic component checks as `npm run verify`, then the browser E2E gate and `npm audit --audit-level=low` under Node.js 24.18.0 and npm 10.9.2.

Set `USL_E2E_CRAWL_SOURCES=1` only when an operator intentionally wants the best-effort external source reachability report. That optional crawl treats only HTTP 2xx and 3xx responses as reachable. Network failures and HTTP 4xx or 5xx responses are reported as unsuccessful reachability, but the report is diagnostic: it does not establish source validity, factual correctness, or currency, and it is not a substitute for reviewing the cited primary source.

The browser harness checks the keyboard path and accessible names used by the application. No automated axe/WCAG conformance scan is currently part of the repository gate, so these tests must not be treated as a complete accessibility certification.
