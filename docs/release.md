# Release and verification runbook

This site is released from Forgejo `main`. The public release path is:

```text
Forgejo push (main)
  -> GitHub-compatible webhook
  -> Argo Events EventSource/Sensor
  -> Argo WorkflowTemplate website-build
  -> Cloudflare Pages project chess-jedarden-com
  -> https://chess.jedarden.com/
```

The Argo and Cloudflare configuration described here is managed in the
`declarative-config` repository. The application repository owns the source,
build, headers, and live-site verification.

## Before releasing

From a clean checkout of the intended commit, run the repository checks and
build locally:

```sh
npm ci
npm test
npm run build
```

The build writes the deployable site to `dist/`. `npm run build` first copies
the pinned Stockfish browser files from `node_modules` into `public/engine/`
and then runs Vite. Do not deploy `public/` directly: it is the source tree,
whereas `dist/` is the complete built site.

Push the checked commit to Forgejo `origin` on `main`. Do not run Wrangler
locally for a normal release. The deployment token is supplied to the Argo
workflow through the `cloudflare-pages-secret` Kubernetes Secret, which is
synced from OpenBao; it must never be placed in a command line, source file, or
log.

## Argo and Cloudflare Pages sequence

1. The Forgejo push mirror sends a GitHub-compatible `push` event. The
   `github-webhooks` EventSource registers the chess repository as
   `chess-jedarden-com`.
2. The `website-build-sensor` accepts only a push whose ref is
   `refs/heads/main`. It submits a `website-build` Workflow using:

   ```text
   repo:       jedarden/chess.jedarden.com
   branch:     main
   build-dir:  .
   build-command: npm ci && npm run build
   output-dir: dist
   cf-project: chess-jedarden-com
   ```

3. The workflow runs the pinned `website-builder` image, checks its toolchain
   freshness, clones `main` from Forgejo, and runs the build. The optional
   ARMOR dependency cache is best effort; a cache miss or cache failure falls
   through to a normal `npm ci` build.
4. After a successful build, the workflow runs the equivalent of:

   ```sh
   wrangler pages deploy dist \
     --project-name=chess-jedarden-com \
     --branch=main \
     --commit-dirty=true
   ```

   Wrangler is pinned in the builder image. `CLOUDFLARE_API_TOKEN` and
   `CLOUDFLARE_ACCOUNT_ID` are provided as workflow environment values; the
   token is not an argument. The workflow retries the build/deploy container
   up to three times with exponential backoff.
5. A successful Wrangler upload makes the new production Pages deployment
   available through the custom domain. The chess trigger has no additional
   Argo post-deploy hook, so the live URL smoke test below is a required
   operator verification after the workflow succeeds.

The authoritative cluster definitions are
`k8s/iad-ci/argo-events/github-eventsource.yml`,
`k8s/iad-ci/argo-events/website-build-sensor.yml`, and
`k8s/iad-ci/argo-workflows/website-build-workflowtemplate.yml` in
`declarative-config`.

## Required response headers

Cloudflare Pages reads `public/_headers` from the built output. Keep these
rules intact when changing the site:

| Path | Required header | Reason |
| --- | --- | --- |
| `/*` | `X-Content-Type-Options: nosniff` | Prevent MIME sniffing. |
| `/*` | `Referrer-Policy: strict-origin-when-cross-origin` | Limit cross-origin referrer detail. |
| `/*` | `Cross-Origin-Opener-Policy: same-origin` | Required for the isolated browsing context. |
| `/*` | `Cross-Origin-Embedder-Policy: require-corp` | Allows the cross-origin-isolated engine to load. |
| `/engine/*` | `Cache-Control: public, max-age=31536000, immutable` | Engine assets are pinned and may be cached for one year. |
| `/*.html` | `Cache-Control: public, max-age=0, must-revalidate` | HTML should revalidate after a release. |

The COOP and COEP headers must be present on the homepage and engine assets.
Without them, `window.crossOriginIsolated` is false and the WebAssembly chess
engine cannot load correctly. The Vite dev-server headers in `vite.config.js`
are useful locally, but production headers come from `public/_headers`.

## Post-publish URL verification

After the Argo workflow is `Succeeded` and Cloudflare reports the deployment
ready, run the production smoke test with a working Chromium executable:

```sh
CHESS_BROWSER_PATH=/path/to/chromium npm run test:production
```

The default target is `https://chess.jedarden.com/`. To check a Pages URL or a
controlled alternate deployment, set `CHESS_PRODUCTION_URL`:

```sh
CHESS_PRODUCTION_URL=https://example.pages.dev/ \
CHESS_BROWSER_PATH=/path/to/chromium \
npm run test:production
```

The test is complete only when all of the following pass:

- the homepage returns HTTP 200 and has the expected title;
- the homepage and every engine asset return HTTP 200 and expose both COOP
  and COEP;
- the browser reports `window.crossOriginIsolated === true`;
- the Agentation root and feedback toolbar mount;
- a real `1. e4` game completes depth-8 analysis and produces a score; and
- there are no browser console errors, page errors, or failed resource
  requests.

If Chromium is unavailable, the test is skipped rather than being a valid
release verification. Install or provide `CHESS_BROWSER_PATH` and rerun it.

## Failure handling and rollback

Use the first failing stage to choose the response:

| Failure | Expected result | Action |
| --- | --- | --- |
| `npm test` or `npm run build` fails locally | Nothing is published. | Fix the commit, rerun the checks, and push a corrected `main`. |
| Argo event is not created | Nothing is published. | Check the Forgejo webhook, the `main` ref filter, and the chess Sensor trigger. Once the event path is healthy, rerun the workflow for the intended commit through the Argo workflow interface. |
| Argo build step fails | Wrangler is not reached because the container uses `set -e`; normally nothing is published. | Inspect the failed workflow logs. Automatic retries cover transient failures. Fix source/toolchain/configuration failures and push a new commit; retry the same workflow only when the failure is transient and the checked commit is still the intended release. |
| Wrangler fails or its result is ambiguous | The Pages deployment may be absent or may exist without becoming production. | Check the Argo logs and Cloudflare Pages deployment history before retrying. Do not run an ad-hoc upload with a token in argv. Retry the workflow only after confirming which state Cloudflare has recorded. |
| Post-publish smoke test fails | A bad deployment may already be serving production. | Treat the release as failed. Record the Pages deployment and commit, then roll production back to the last known-good **successful production** deployment in Cloudflare Pages: **Workers & Pages → project → Deployments → target deployment → Rollback to this deployment**. Preview deployments are not rollback targets. |

Rollback changes the active Cloudflare production deployment but does not
repair `main`. After service is restored, revert or fix the offending commit on
`main`, run the local checks, push, and allow the normal Argo release to
publish the corrected source. Rerun the production smoke test after either a
rollback or a corrective release. If the rollback target is unavailable,
repair the source and publish a corrected deployment instead; never delete a
known-good deployment as a substitute for rollback.

When investigating a failure, retain the Argo workflow name, source commit,
Cloudflare deployment ID/URL, failing test assertion, and the exact
verification result. This makes a later rollback or retry unambiguous without
exposing deployment credentials.
