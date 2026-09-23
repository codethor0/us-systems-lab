# Deployment

The repository is configured for Cloudflare Workers Static Assets. `wrangler.jsonc`
uses `dist/`, SPA fallback, and `run_worker_first: false`. There is no Worker
application script, database, runtime secret, or server-side API. `public/_headers`
is copied into the Vite build. Repository configuration does not establish that
the corresponding version is deployed or that its live checks have passed.

## Release environment and gates

Use Node.js 24.18.0 from `.nvmrc` and npm 10.9.2 from `packageManager`.
Reproduce the exact candidate from its lockfile in a clean environment:

```sh
npm ci
npm run verify
npm run test:e2e
npm audit --audit-level=low
```

`verify` includes the independent numerical audit. `test:e2e` builds the production
site and exercises the Block Board against the actual model. See [TESTING.md](TESTING.md)
for coverage scope and assurance limits. Keep screenshots, logs, private audit
instructions, and signing material outside the public repository.

A failed test, unresolved reproducible regression, stale source snapshot, wrong
build identifier, or failed audit blocks publication. Do not reduce thresholds,
remove tests that still cover active behavior, or deploy first and validate later.

## Signed source and GitHub

The owner reviews the exact diff and creates the cryptographically signed commit.
Do not change the owner's Git identity or signing configuration. Push a reviewed
feature branch, obtain review, and require successful CI for the exact release
commit before it enters protected `main`. Do not force-push, auto-merge, or accept
an unsigned release-history commit.

The GitHub Actions workflow verifies code; it deploys nothing. Cloudflare Workers
Builds is a separate integration. Do not assume a successful Cloudflare build
means GitHub's verification job succeeded. Branch protection and explicit release
review are the gates before code reaches the production branch.

## Cloudflare configuration

Use the existing Worker named `us-systems-lab`; its name must match the configuration.
The build command is `npm run build`; the deploy command uses the locally pinned
Wrangler version, `npx --no-install wrangler deploy`. Do not add a Worker script,
server-side services, paid storage, or new credentials for this static release.
Review current Cloudflare plan and billing settings before changing infrastructure;
no paid service or surprise metered runtime is part of this project's design.

Workers Builds can publish when the production branch changes. First check whether
it already published the exact approved commit. Do not deploy a second, different
local candidate over it. If an owner-controlled manual deployment is needed, use
only the clean, signed, verified release checkout, authenticated locally. Never
paste account tokens or signing keys into source, logs, or audit bundles.

## Live verification and rollback

Record the previously active Cloudflare version before publication. Keep it
available for rollback. After publication, verify the displayed Block Board build
identifier and the served HTML, JavaScript, CSS, and favicon against the approved
build. An old open preview tab is not production verification.

Run the same browser contract against the canonical production HTTPS address from the
verified checkout:

```sh
USL_E2E_PRODUCTION=1 npm run test:e2e
```

The production switch does not accept a URL. The browser harness maps it to the canonical
US Systems Lab production origin, so the verifier cannot be redirected to an arbitrary
network target.

Check the root document and representative static assets for HTTP success and the
security headers declared in `public/_headers`, including the content security
policy, frame protection, MIME-sniffing protection, referrer policy, and permissions
policy. Confirm Share/reload, Reset, native inputs, automatic response bars, actual
square counts, reduced motion, and mobile layout. No source change may intervene
between candidate validation and this comparison.

If a known regression appears, stop the release and restore the recorded previous
Worker version through the owner's approved Cloudflare rollback procedure. Do not
rewrite Git history, invent a rollback version, or delete recovery worktrees as
part of deploying. Publish a live URL or release-success statement only after the
actual deployed version passes its required checks.
