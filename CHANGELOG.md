# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [0.1.4] - 2026-11-07

Fixed video downloads that returned 401 from gateways which require the same Bearer token on the media URL. The downloader now retries the provider URL with authentication and falls back to the configured content endpoint.

## [0.1.3] - 2026-11-07

Removed external inspiration attribution and the legacy data-directory migration from earlier prototypes. The four workbenches are unchanged.

## [0.1.2] - 2026-11-07

First npm publication as **@exccoder/dsh-media-workbench**. The package was renamed from the `@modern` scope before publishing; there are no functional changes since 0.1.1. The GitHub `v0.1.1` release is superseded by `v0.1.2`.

## [0.1.1] - 2026-11-07

Initial GitHub release under `@modern/dsh-media-workbench`; not published to npm. Superseded by 0.1.2.

### Added

- Package name `@modern/dsh-media-workbench`, sidebar title「摩登-媒体工作室」with the English label `Modern-MediaStudio`, following the DSH locale.
- **Image Studio**: prompt, negative prompt, nine style presets, six aspect ratios, 1–4 images, reference-image editing through `/images/edits`, favorites, search, history, lightbox, retry/download/reuse.
- **Writing Studio**: local document library, autosave, Markdown export, selection-aware continue/polish/expand/rewrite/outline/title actions, streaming output with stop/apply/discard.
- **Star Map**: typed node graph (prompt, writing, image, video, preview, note), drag-to-connect ports, type/single-input/cycle validation, topological parallel execution, run-to-node, undo/redo, templates, user blueprints, JSON import/export, responsive inspector.
- **Video Studio**: text-to-video, image-to-video through a generic async task API, and a no-video-provider **Storyboard** mode that generates four keyframes and plays them in the browser.
- Five model tools: `modern_media_generate_image`, `modern_media_save_document`, `modern_media_generate_video`, `modern_media_run_star_map`, `modern_media_workspace_overview`.
- Local-first storage under `$DSH_HOME/media-workbench-modern/`, masked API keys, same-origin/DSH-auth checks, whitelisted static files, and SSRF protection for remote media.
- Light/dark theme and Chinese/English UI synced from DSH.
- Offline verification suite (`npm test`) and a standalone dev server with mock providers (`npm run dev`).

### Known limitations

- Video providers vary; the current adapter expects the common create → poll → download shape. Paths and extra parameters are configurable.
- Without a video provider only Storyboard mode is available; there is no local mp4 encoding.
- One active image provider configuration (no multi-key rotation).
- Narrow layouts collapse the document list, node palette and inspector.

## [0.1.0]

Internal prototype used during development. Not published.
