# Browser compatibility and engine failures

Chess Workbench parses PGN and replays a game in the browser. Engine analysis
is an optional local feature with a few additional browser and hosting
requirements.

## Requirements for engine analysis

Use a current browser with Web Workers, WebAssembly, and `SharedArrayBuffer`
support. The page must be served from a secure context: HTTPS in production;
`localhost` is also trusted for local development.

The page must be cross-origin isolated. A deployment needs both response
headers on the page and its engine files:

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

The browser check is equivalent to:

```js
window.crossOriginIsolated === true &&
typeof SharedArrayBuffer === 'function'
```

The static deployment must also serve these same-origin, non-empty assets:

- `/engine-worker.js`
- `/engine/sf_19_smallnet.js`
- `/engine/sf_19_smallnet.wasm`
- `/engine/nn-61e7af4bb97d.nnue`

The engine runs in a worker and loads the WebAssembly program and neural
network locally. The game notation is not uploaded for analysis.

## What happens when a requirement is missing

The page reports the missing browser or hosting prerequisite in the notation
panel before analysis starts. PGN parsing and board replay remain available,
but the **Analyze game** action cannot run the engine until the requirement is
fixed. On a deployment, inspect the page response headers first; on a local
copy, use `npm run dev` or another server rather than opening `index.html`
directly.

If an engine worker or asset fails after a compatible page has loaded, the
page shows the worker's failure, including an HTTP status when one is
available. The parsed game remains on the board so it can still be replayed.
Fix the deployment or network blocking, reload the page, and try again.

## Troubleshooting

1. Open the site over HTTPS, or use the Vite development server for local
   work.
2. In the browser console, confirm `window.crossOriginIsolated` is `true` and
   `typeof SharedArrayBuffer` is `"function"`.
3. Request each engine asset and confirm it returns HTTP 200 with a non-empty
   body. The production smoke test checks these assets and their COOP/COEP
   headers:

   ```sh
   CHESS_BROWSER_PATH=/path/to/chromium npm run test:production
   ```

4. If the browser blocks a worker or WebAssembly file, check extensions,
   content-security policy, proxy rules, and the response's MIME type before
   retrying.
