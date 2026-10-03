# Dependency and asset provenance

This page is the change record for the third-party code and data shipped by
Chess Workbench. The exact versions below are the versions resolved by
`package-lock.json` at this revision. `npm ci` is the reproducible install
command; do not update a dependency by editing `node_modules` or by copying a
new file from a CDN.

## Current pins

| Dependency or asset | Pin in this repository | Source and provenance | License to preserve |
| --- | --- | --- | --- |
| [chess.js](https://github.com/jhlywa/chess.js) | npm `1.4.0`; lockfile integrity `sha512-BBJgrrtKQOzFLonR0l+k64A98NLemPwNsCskwb+29bRwobUa4iTm51E1kwGPbWXAcfdDa18nad6vpPPKPWarqw==` | [v1.4.0 release](https://github.com/jhlywa/chess.js/releases/tag/v1.4.0), commit `ce1ff9e` | BSD-2-Clause |
| [Stockfish Web](https://github.com/lichess-org/stockfish-web) | npm `@lichess-org/stockfish-web` `0.5.0`; lockfile integrity `sha512-4p+bnJKr+ufCanyaqUFJkvajVf443sg51+OPnDKjAi91kiY8DGAbfjj5WlmWybwILOF7ouPEjeCYwlPUV3EU3g==`; selected target `sf_19_smallnet` | [package source manifest](https://github.com/lichess-org/stockfish-web/blob/main/README.md#sources): Stockfish upstream base [`edb0d9db`](https://github.com/official-stockfish/Stockfish/commit/edb0d9db6731067ec50ce619ff372b463bc4dd5d), tag `sf_19`, with the `sscg13/size-optimize-nnue` small-network patch | The npm package declares AGPL-3.0-or-later and includes a GPLv3 `LICENSE`; preserve the upstream license and source notices when changing the package |
| Stockfish NNUE network | `public/engine/nn-61e7af4bb97d.nnue`; SHA-256 `61e7af4bb97d51eeeb25d322916f86513b5cd3a827ce189c98c6e31946f99e5b` | [Stockfish Web’s named network](https://github.com/lichess-org/stockfish-web/blob/main/README.md#sources), downloaded from the [official Stockfish test-server endpoint](https://tests.stockfishchess.org/api/nn/nn-61e7af4bb97d.nnue). The 12-character filename suffix is the beginning of the SHA-256. | Stockfish network distribution terms; keep the Stockfish license and corresponding-source link with the engine distribution |
| [Agentation](https://github.com/benjitaylor/agentation) | npm `3.0.2`; lockfile integrity `sha512-iGzBxFVTuZEIKzLY6AExSLAH6i6SwxV4pAu7v7m3X6bInZ7qlZXAwrEqyc4+EfP4gM7z2RXBF6SF4DeH0f2lA==` | npm package from the [upstream repository](https://github.com/benjitaylor/agentation); React and React DOM are peer dependencies (this app currently resolves both to `19.2.0`) | PolyForm Shield 1.0.0; retain the license and notices, and review the non-compete condition before changing how the toolbar is used |
| Piece graphics | `src/pieces.json`; SHA-256 `58a897986ca254676384bc996a0a910ff1829d6ac51db8ed309e0c2318e4c3f1` | Snapshot of [`chess.svg.PIECES`](https://github.com/niklasf/python-chess/blob/v1.11.2/chess/svg.py) from python-chess `1.11.2` (tag commit `3516d7c`). The application stores the SVG strings as a JSON piece-symbol map and does not install python-chess. | The piece artwork is credited to Colin M. L. Burnett and is described upstream as triple-licensed under GFDL, BSD, and GPL; retain that attribution and the applicable license text |

The generated `public/engine/sf_19_smallnet.js` and
`public/engine/sf_19_smallnet.wasm` files are intentionally ignored. They are
copied from the locked npm package by `scripts/prepare-engine.mjs` during
`npm run build`. The NNUE file is checked in because it is fetched separately
from the Stockfish test-server endpoint and must remain available to the
static build.

## Updating a dependency or asset

1. Open the upstream release, source, and license pages in the table. Confirm
   the intended version, artifact variant, source commit, license, and any
   peer/runtime requirements before changing files. Record the new values in
   this page in the same change.
2. Update npm dependencies with an explicit version and refresh the lockfile.
   For example:

   ```sh
   npm install --save-exact chess.js@<version> \
     @lichess-org/stockfish-web@<version> agentation@<version>
   npm ci
   ```

   Keep React and React DOM compatible with Agentation’s peer range. Review
   the resulting `package.json` and `package-lock.json`; both the package
   version and the lockfile integrity must change together.
3. For Stockfish Web, verify that `scripts/prepare-engine.mjs` still copies
   the intended target. Run `npm run build`, then confirm that the generated
   JS and WASM are present in `dist/engine/` and came from the new locked
   package. If the engine target or NNUE filename changes, update
   `src/engine-support.js`, the browser tests, the compatibility/release docs,
   and this manifest together.
4. For a new NNUE, download only the named file from an official Stockfish
   endpoint into a temporary location. Check that its SHA-256 equals the
   first 12 characters in its filename, record the full hash here, replace the
   checked-in file, and verify that the worker loads that exact filename. Do
   not silently substitute a network from a third-party mirror.
5. For piece graphics, copy the eight symbol entries from a versioned
   python-chess `chess.svg.PIECES` source (or use a separately licensed set),
   preserve the attribution, compute a new `src/pieces.json` hash, and test
   the starting position and promoted pieces in the browser. Do not introduce
   python-chess as a runtime dependency just to render these already-snapshotted
   SVG strings.

## License and verification checklist

Before merging an update:

- Read the upstream license and the installed package metadata under
  `node_modules/<package>/package.json`; do not infer a license from a
  repository name. Preserve BSD notices for chess.js, Stockfish’s GPL/AGPL
  notices and corresponding source, Agentation’s PolyForm Shield license,
  and the piece-art attribution. The repository’s `LICENSE` currently carries
  the GPLv3 text used by the engine distribution; it does not replace the
  other dependency notices.
- Run `npm ci` from a clean checkout to prove the lockfile is sufficient.
- Run `npm test` for parser, engine-loading, analysis, and Agentation mounting
  coverage, followed by `npm run build`.
- Inspect the built output for every expected engine asset and compare the
  NNUE hash with this page. Confirm that the production bundle still serves
  the COOP/COEP headers required for the browser engine.
- When a Chromium executable is available, run
  `CHESS_BROWSER_PATH=/path/to/chromium npm run test:production` against the
  deployed URL after publishing. This must cover a real depth-8 analysis,
  engine assets, and the rendered Agentation toolbar. A skipped browser test
  is not release verification.
- Record the upstream version/commit, hashes, license review, commands, and
  any skipped checks in the owning bead and in the commit description or
  release notes as appropriate.
