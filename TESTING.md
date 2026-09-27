# Testing

The project is tested at three levels: the model and helpers in unit tests, the numbers against an
independent implementation, and the built page in real Chrome.

## Environment

Releases use Node.js 24.18.0 (pinned in `.nvmrc`) and npm 10.9.2. Dependencies are locked in
`package-lock.json`. Install from the lockfile and do not regenerate it during routine checks:

```sh
npm ci
```

## Before opening a pull request

```sh
npm run verify
npm run test:e2e
npm audit --audit-level=low
```

CI runs the same checks, one step each, on every pull request, every push to `main`, and once a
week on a schedule. The weekly run catches breakage from a runner or dependency change without a
push.

The audit runs twice. Advisories in the runtime dependencies (React and React DOM, which ship in
the site) always fail the run. Advisories in build and test tools fail pull requests and pushes,
but on the weekly run they show as a failed step without failing the job, so `main` stays green
until the next change fixes them.

## `npm run verify`

Lint, type check, format check, unit and repository tests with coverage, the production build, the
Python script tests, the emoji and attribution checks, and the numerical audit. It does not start a
browser.

The 100 percent coverage threshold applies to the core model and the pure display helpers, not to
every line of DOM rendering. Component and browser tests cover the rest of the interface.

## `npm run test:math`

Checks the production propagation and effects code against a separate exact-rational path
enumeration: 420 single-input grid scenarios, 760 signed pairs, and 500 multi-input scenarios, for
1,680 scenarios and 33,600 indicator comparisons. It compares raw and clamped results, whole-block
rounding, displayed direction and color, and input-order independence. As a control, it reverses a
propagation sign in a temporary compiled copy and requires the audit to catch it. No source file is
changed.

`USL_MATH_REPORT=1` writes a machine-readable report to `.artifacts/math/model-audit.json`.

## `npm run test:e2e`

Requires Google Chrome or Chromium. Builds the production bundle and drives the Block Board:

- Every indicator at both extremes, at 1440, 390 and 320 pixel widths, compared square by square
  against `scripts/block-oracle.mjs`.
- All 420 single-input grid positions at desktop width, checking bar width, marker position, color,
  the accessible meter value, and squares.
- Multiple inputs together, source links, Share links, reload, Reset, browser history, keyboard,
  pointer and touch input, and reduced motion.
- The category filter, cited-relationships-only mode and scenario A at 1440, 390 and 320 pixel
  widths: hidden tiles, no modeled edge in cited-only mode, the comparison text, no horizontal
  overflow, and an unchanged address bar.
- A deliberately broken tile, which must make the suite fail.
- An axe-core scan for WCAG 2.2 A and AA rules in light and dark mode, at neutral and with a
  lever raised, with every "Why & source" panel open, and once more with the filter, cited-only
  mode and scenario A all active. A button with no accessible name is added
  at the end as a control and must be reported.

The page's build identifier must match the source being tested.

## Address-bar updates

The board, meters, counts and Share field update immediately. Writes to the address bar are
limited to one every 400 milliseconds. Reset and history navigation cancel queued writes. A failed
or ignored History API write is retried a few times; Share always uses the current inputs. An input
made less than 400 milliseconds before closing the tab may not reach the address bar.

The browser suite checks this with a 250-key burst, a pending write that Reset and history
navigation must override, and a check that the browser reports no navigation throttling.

## What the checks do not establish

The checks show that the code matches the model's stated assumptions. They say nothing about
whether those assumptions are true of the economy.

Automated rules catch only part of WCAG, so the axe-core scan is
not an accessibility certification.

`npm run check:sources` produces a best-effort external source reachability report. It needs
network access and is not part of `verify` or CI. A 2xx or 3xx response counts as reachable. The
report does not establish source validity, accuracy, or currency; read the source itself.

## Changes that need more evidence

- Data changes keep source URL, retrieval date, value type, units, and as-of period consistent.
- Model changes keep edges one-way. A reverse relationship needs its own edge. Modeled and empirical
  edges stay distinct.
- Changes to URL encoding, propagation, the block display, deployment configuration, dependency
  policy, or browser behavior come with a regression test for that behavior.

Do not include build output, credentials, local paths, or private logs in a pull request.
