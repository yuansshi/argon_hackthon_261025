# GitHub Pages deployment

Public URL: https://yuansshi.github.io/argon_hackthon_261025/

GitHub Pages serves static files, not the Node.js API or WebSocket relay. This deployment is an explicitly labeled **practice demo**, not a publicly hosted Gemini tutor.

## Available in the browser

- Four authored math quests and visual explanations, including the WebGL pond where supported.
- Original tutor illustrations and the fictional static portrait.
- Numeric and equivalent-fraction answers, hints, streaks, and best stars.
- The 60-second narrated MP4.

The browser runs the same authored quest rules as the local server. Hinted questions cannot earn stars, repeated submissions cannot earn extra stars, and a wrong answer resets the current streak. These are local practice rules, not secure exam grading: users can inspect or change client-side code and storage.

Gemini chat, live audio, and camera sharing are disabled with an inline explanation. No API keys, backend modules, credential helpers, raw media captures, or learner messages are deployed. Pages itself receives normal website requests; no claim of zero logging by GitHub is made.

## Build and publish

```sh
npm ci --ignore-scripts
npm test
npm run build:pages
```

The build creates `dist-pages/` from an explicit public-file allowlist, the portable authored quest engine, required Three.js files, and the demo MP4. It inserts an explicit static-practice deployment marker. Public assets use relative paths so the repository subpath works.

The `Pages` workflow tests and builds pull requests. Only a successful build on `main` can deploy through the `github-pages` environment, with the minimum Pages/OIDC permissions. Environment protection and required approvals remain effective; do not bypass them. Enable GitHub Actions as the repository's Pages publishing source.

For a local static preview, optionally run:

```sh
python3 -m http.server 8793 --bind 127.0.0.1 --directory dist-pages
```

Then visit `http://127.0.0.1:8793/`. This does not start Gemini. For the complete AI tutor, follow the local setup in the repository README; do not expose the loopback development relay publicly.
