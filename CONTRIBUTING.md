# Contributing

Thanks for taking the time to improve the workbench.

## Development setup

Requirements: Node.js 20+ (22 recommended). There are no runtime build steps and no dependencies to install for development.

```bash
git clone <your-fork>
cd dsh-media-workbench
npm test                  # offline verification, Node's built-in test runner
npm run dev               # standalone preview at http://127.0.0.1:7788/media-workbench-modern/
```

The dev server uses local mock image/video providers and a mock writing stream, so it does not need API keys or DSH.

To test inside DSH, install the directory into a scratch profile and restart that profile:

```bash
dsh plugin --profile <scratch> add /absolute/path/to/dsh-media-workbench
dsh --profile <scratch> --port 7801 --no-open
```

## Code layout

| Path | Role |
| --- | --- |
| `src/` | Host half: HTTP routes, local storage, settings, image/video adapters, writing prompts, Star Map execution, model tools |
| `lib/client.js` | Browser half: sidebar entry and iframe panel, written as a CJS closure factory |
| `web/` | Workbench UI as native ES modules; no bundler |
| `tools/verify.mjs` | Offline tests |
| `tools/dev-server.mjs` | Standalone preview server with mock providers |

## Pull requests

- Keep the zero-build approach for `web/`; do not add a bundler without a strong reason.
- Add or update tests in `tools/verify.mjs` for graph validation, storage, prompts or settings changes.
- Run `npm test` before pushing.
- Do not commit API keys, local absolute paths, generated media, or `settings.json`.
- Keep user-visible text bilingual (the UI passes both Chinese and English strings to `t()`).
- Security-sensitive changes (routes, path handling, key storage, remote URL fetching) should explain the threat model in the PR description.

## Commit messages

Short imperative subjects are enough (`fix: reject cyclic graph imports`). No strict convention is enforced.

## License

By contributing you agree that your contribution is licensed under the MIT License.
