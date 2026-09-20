# Deployment

Status: **not deployable yet.** The repository has a tested Vite production build, but it still
has no Wrangler config, pinned Wrangler dependency, or security headers. Section 4 lists what must
exist before deployment. Nothing in this file has been run against a real Cloudflare or GitHub
account.

This document records a decision, the facts it rests on, and the manual steps that only the
repository owner can perform. Everything account-specific is a manual step written for a human.
local development tooling holds no Cloudflare or GitHub credentials, runs none of these steps, and must not be
given any.

## 1. Decision record

- **Target:** Cloudflare Workers with static assets, deployed by Workers Builds (Cloudflare's Git
  integration). Decided 2026-09-19.
- **Why not Cloudflare Pages:** the earlier plan named Pages. When the docs were read on
  2026-09-19, the Pages overview said to start new projects with Workers, and the Workers
  migration guide describes moving a Pages project as often straightforward. No Pages deprecation
  notice was found. Pages would still work; it would likely mean a migration later.
- **Why not GitHub Pages:** an earlier plan considered it. Cloudflare is the chosen host.
- **CI deploys nothing.** `.github/workflows/ci.yml` runs checks only, and a test fails if the
  workflow ever mentions deploying or publishing. Cloudflare deploys from its own integration.

## 2. Facts this plan rests on

Read from Cloudflare's documentation on 2026-09-19. Limits change, so re-read the linked page
before relying on a number.

| Fact                                             | Value                                                                                              | Source (last updated per the page)                                                                                       |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Requests for static assets                       | Free and unlimited. Storing assets has no extra cost.                                              | [Static assets billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/) (Apr 23, 2026) |
| Static asset files per Worker version, Free plan | 20,000                                                                                             | [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)                                             |
| Size of one static asset                         | 25 MiB                                                                                             | [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)                                             |
| `_headers` file, both plans                      | 100 rules, 2,000 characters per line                                                               | [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)                                             |
| Workers Builds, Free plan                        | 3,000 build minutes a month, 1 concurrent build, 20-minute timeout, 64 build environment variables | [Builds limits and pricing](https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/) (May 29, 2026)   |
| Build image                                      | Node.js 24.18.0 by default, npm 10.9.2, `.nvmrc` and `NODE_VERSION` honored                        | [Build image](https://developers.cloudflare.com/workers/ci-cd/builds/build-image/) (Jul 30, 2026)                        |
| Build and deploy commands                        | Optional build command, then a deploy command that defaults to `npx wrangler deploy`               | [Builds configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/) (Aug 28, 2026)             |
| Wrangler version used by builds                  | The one set in `package.json`                                                                      | [Builds configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)                            |
| Production branch                                | Defaults to the repository's default branch, changeable                                            | [Build branches](https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/) (Aug 28, 2026)                  |
| Pull request builds                              | Off unless "non-production branch builds" is enabled                                               | [Build branches](https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/)                                 |
| API token for builds                             | Cloudflare generates one automatically unless you choose your own                                  | [Builds configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)                            |
| Repository without a Wrangler config             | Connecting it makes Cloudflare open a pull request that adds one                                   | [Builds overview](https://developers.cloudflare.com/workers/ci-cd/builds/) (Aug 28, 2026)                                |
| Worker name                                      | Must match the `name` in the Wrangler config, or the build fails                                   | [Builds overview](https://developers.cloudflare.com/workers/ci-cd/builds/)                                               |

Two other things the docs say and this plan uses: Pages and Workers both state that static asset
requests are free. Neither page uses the word "bandwidth", so this plan does not claim bandwidth
is unmetered.

## 3. What CI already guarantees

The `verify` job runs on every pull request to `main` and every push to `main`: install from the
lockfile, lint, type check, format check, tests with a 100 percent coverage threshold, a production
build, the script tests, the emoji check, and `npm audit` at high severity. It was rehearsed on a
cold export of the repository, and `npm ci`, tests and lint were also run under npm 10.9.2, the
version in Cloudflare's build image.

Cloudflare builds independently of GitHub Actions. The pages read do not say that Workers Builds
waits for GitHub checks, so assume it does not. Branch protection is what keeps a failing change
off `main`, and Cloudflare deploys what reaches `main`.

## 4. Prerequisites in this repository

The first prerequisite is now implemented by the interface iteration. Do not connect Cloudflare
until the remaining items are implemented and all prerequisites are merged to `main`.

1. Complete: the `build` script runs `vite build`, writes to `dist/`, and Vite `base` is `/`.
2. A `wrangler.jsonc` at the repository root, committed by you before connecting. Without one,
   Cloudflare opens an automatic pull request containing configuration you did not write, and
   this plan keeps the first deployment configuration under your control. A minimal shape,
   modeled on Cloudflare's migration guide:

   ```json
   {
     "name": "us-systems-lab",
     "compatibility_date": "YYYY-MM-DD",
     "assets": { "directory": "./dist" }
   }
   ```

   Set `compatibility_date` to the date the file is written.

   No secrets and no account IDs belong in this file. `not_found_handling` is only needed if the
   app gains client-side routes. Scenario links use the query string and do not need it.

3. `wrangler` as an exact-pinned dev dependency, because builds use the version in `package.json`.
   Check the current release and its peer requirements with `npm view` before pinning it.
4. Security headers in `public/_headers`, chosen with the interface (a content security policy
   needs the real asset list). Respect the 100-rule limit.
5. A green `verify` run on a pull request.
6. Branch protection on `main`, from section 5.

## 5. Manual steps: GitHub (you)

GitHub's menus move, so find each setting by its name in
[About protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches).

- Protect `main` and require **Require status checks to pass before merging**, selecting the
  check named `verify`. GitHub advises that required job names be unique across workflows, and
  `verify` is the only job.
- Turn on **Require signed commits**, and require changes to go through a pull request. Read
  GitHub's description of the signing setting first. It says commits on a pull request's head
  branch are checked too, so an unsigned commit there can block a squash merge even though GitHub
  signs the final commit. The ways past a blocked pull request are to rewrite and sign the commits,
  or to have someone with bypass permission merge it. The contribution guide tells outside
  contributors this.
- Leave **Allow force pushes** and **Allow deletions** off. Think before choosing **Do not allow
  bypassing the above settings**, because it would remove your own way past an outside pull
  request whose commits are unsigned.
- Dependabot: GitHub's documentation for Dependabot security updates says Dependabot signs its own
  commits by default, so its pull requests should satisfy the signing rule. That sentence was read
  on the security-updates page only. Check that the first Dependabot pull request shows as
  verified before relying on it.

## 6. Manual steps: Cloudflare (you)

Follow the dashboard flow in the
[Builds overview](https://developers.cloudflare.com/workers/ci-cd/builds/). The names below are
the ones the docs use on 2026-09-19. If the dashboard differs, trust the dashboard and the
current docs over this list.

1. In the Cloudflare dashboard, open **Workers & Pages**, select **Create application**, then
   **Get started** next to **Import a repository**, and choose your Git account and this
   repository.
2. The first time, you will be asked to install and authorize the Cloudflare app on GitHub. If
   GitHub offers a choice between all repositories and selected repositories, choose selected and
   pick only this one.
3. Set the Worker name to the `name` in `wrangler.jsonc`, exactly.
4. Build command: `npm run build`. Deploy command: leave the default, `npx wrangler deploy`.
   Root directory: leave empty. Node comes from `.nvmrc` (24).
5. API token: Cloudflare will create one for you by default. You may instead create a token with
   the smallest permissions that let a build deploy, and select it. Read Cloudflare's current
   token documentation for the exact permissions before choosing, because they are not listed
   here. Keep every token out of this repository, out of chat, and away from local development tooling.
6. Production branch: confirm it is `main`.
7. Leave non-production branch builds off until you have a reason. This plan did not verify how
   pull requests from forks are handled.
8. Select **Save and Deploy**, and open the `workers.dev` address the dashboard shows.

## 7. After the first deploy

- Open the deployed address and exercise the interface, including a shared scenario link.
- Fetch the page headers and confirm the ones from `public/_headers` are present.
- Confirm in GitHub that every commit on `main` shows as verified, and that Cloudflare's app has
  access to this repository only.
- Roll back with Cloudflare's [rollback documentation](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/),
  after reading it once before you need it.

## 8. Not verified

- Whether Workers Builds waits for GitHub Actions results. Assumed not.
- How pull requests from forks are built when non-production branch builds are enabled.
- The exact permissions of a least-privilege API token.
- Node minor-version parity: the build image uses 24.18.0, and local and CI runs use the latest
  24.x. Lockfile installs were tested with npm 10.9.2 only.
- The workflow file was not checked with a dedicated GitHub Actions linter, and Actions itself
  cannot run in this environment.
- Every limit in section 2, once Cloudflare edits its pages.
