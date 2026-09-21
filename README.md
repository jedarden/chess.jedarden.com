# Chess Workbench

A static chess game review at [chess.jedarden.com](https://chess.jedarden.com). Paste numbered moves or PGN, or upload a `.pgn` file. The page replays every move, calculates a running position score, and labels choices using a browser based Stockfish 19 small network engine. Analysis runs on the visitor's device; game notation is not sent to a server.

## Local development

Requires Node.js 22 or newer.

```sh
npm ci
npm run dev
npm test
npm run build
```

`npm run build` writes the static page to `dist/`, including the engine JavaScript, WebAssembly, and neural network. The site needs `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` response headers for the engine. Cloudflare Pages reads these from `public/_headers`.

## How the review works

The engine evaluates every position, using two principal variations and a selectable search depth of 8, 12, or 16. The displayed score is in pawn units from White's perspective. A positive score favors White; a negative score favors Black. Forced mates use `M` notation. The graph shows how that score changes after each half move.

Move labels compare the expected score before a move with the expected score after it. When available, the engine's win, draw, and loss estimates are used; otherwise a centipawn score is converted with a logistic curve. A move matching the top principal variation is **Best**. A clearly superior best move can be **Great**. A sound piece offer that the opponent's preferred reply accepts can be **Brilliant**. Other labels use increasing expected score loss: **Excellent**, **Good**, **Inaccuracy**, **Mistake**, and **Blunder**. **Miss** marks a substantial loss of an already favorable position.

These are deliberately transparent heuristics, not official labels or calibrated Elo estimates. Search depth and hardware change the outcome, and one game cannot establish a player's rating. The summary shows average expected score lost by each side instead.

## Source and deployment

The app uses [chess.js](https://github.com/jhlywa/chess.js) for legal moves and PGN parsing, [Stockfish Web](https://github.com/lichess-org/stockfish-web) for local analysis, and [Agentation](https://github.com/benjitaylor/agentation) for visual feedback. The piece graphics are the standard SVG pieces bundled with python-chess. The engine's AGPL license is included in [LICENSE](LICENSE).

Pushes to Forgejo `main` are the release source. The Argo deployment workflow builds the page and runs Wrangler to deploy it to Cloudflare Pages.
