# Chess Workbench

This repository builds the public static site at `chess.jedarden.com`.

- Work on `main`; commit and push to Forgejo `origin`. The GitHub repository is a mirror.
- Every repository change is covered by a bead in this repository's bead-rs store. Flush its checkpoint after mutations.
- `npm ci && npm run build` produces `dist/`. The build copies the pinned browser engine from `node_modules` and the committed network file from `public/engine/`.
- Run `npm test` for the parser/classifier and browser tests for engine loading, analysis, and Agentation mounting. Test the deployed URL after publishing.
- Keep the page and documentation independent of other chess services. Describe move labels as this site's estimates.
- Never commit tokens or run Wrangler with a token in argv. Deployment secrets belong in OpenBao.
