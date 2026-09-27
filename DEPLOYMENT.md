# Deployment

The site is a static build served by Cloudflare Workers Static Assets. `wrangler.jsonc` points at
`dist/`, uses SPA fallback, and sets `run_worker_first: false`. There is no Worker script,
database, runtime secret, or server-side API. Vite copies `public/_headers` into the build.

## Release gates

Use Node.js 24.18.0 (`.nvmrc`) and npm 10.9.2 (`packageManager`). From a clean checkout of the
release commit:

```sh
npm ci
npm run verify
npm run test:e2e
npm audit --audit-level=low
```

`verify` includes the independent numerical audit. `test:e2e` builds the production site and
drives the Block Board in real Chrome. [TESTING.md](TESTING.md) describes what each check covers.

Any failed check, unresolved regression, stale source data, wrong build identifier, or failed
audit blocks the release. Do not lower thresholds or remove tests that still cover active
behavior. Keep screenshots, logs, and signing material out of the repository.

## Source control

Every commit on `main` is signed by the owner and arrives through a pull request with a passing
`verify` check. No force-pushes and no auto-merge.

CI verifies code and deploys nothing. Merging to `main` does not change production; a manual
deploy does.

## Cloudflare configuration

The Worker is named `us-systems-lab` and must match `wrangler.jsonc`. Build with `npm run build`
and deploy with the pinned Wrangler: `npx --no-install wrangler deploy`. Do not add a Worker
script, server-side service, paid storage, or new credentials. Check the Cloudflare plan and
billing settings before changing infrastructure; the project uses no paid or metered service.

Deployment is manual. Deploy only from a clean, signed, verified checkout of `main`. If production
already serves that exact build, do not deploy again. Changes that leave the built files
unchanged, such as tooling, tests, or documentation, need no deploy. If Cloudflare Workers Builds
is connected later, update this section; a successful Cloudflare build does not mean GitHub CI
passed. Never put account tokens or signing keys in source or logs.

## Live verification and rollback

Before deploying, record the active Cloudflare version so it can be restored. After deploying,
confirm that the build identifier on the page and the served HTML, JavaScript, CSS, and favicon
match the release build. An old open tab is not verification.

Run the browser suite against production from the release checkout:

```sh
USL_E2E_PRODUCTION=1 npm run test:e2e
```

The switch takes no URL. It always targets the canonical production origin.

Check the root document and a few static assets for a successful response and for the headers in
`public/_headers`: content security policy, frame protection, MIME-sniffing protection, referrer
policy, and permissions policy. By hand, confirm Share and reload, Reset, slider and keyboard
input, the automatic response bars, square counts, reduced motion, and the mobile layout.

If a regression appears, roll back to the recorded version with
`npx --no-install wrangler rollback <version-id>`. Announce a release only after the deployed
version passes these checks.
