# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [0.6.0] - 2026-11-11

Every workbench can keep several providers, not just images.

### Added

- **Video and voice** got the same provider list as image: chips to switch, per-provider name / URL / model / key, and a fetched model list you can click.
- **Writing** can now point at its own OpenAI-compatible `/chat/completions` endpoint, with its own provider list. Leave it empty and writing keeps using the current DSH model, exactly as before.
- The model list and 「从接口获取」 work for all four kinds; `models/detect` takes a `kind` and stores the result on the matching provider.
- The writing bench shows the configured model name instead of the DSH one when a writing provider is active.

### Changed

- Settings cards for image, video, voice and writing now share one provider block, so switching, adding, deleting and fetching behave identically everywhere.
- Saving any of them auto-fetches the model list when it is missing or the URL changed, and picks the first model if none is set.

## [0.5.1] - 2026-11-11

Models are fetched, listed and picked instead of typed.

### Added

- The model field now shows a **list of every model the provider offers**, one chip each; clicking a chip selects that model immediately. Manual typing still works.
- Saving a provider with a URL and key **fetches the model list automatically** when it has none, or when the URL changed since the last fetch, and picks the first model if none was chosen.
- Providers remember which base URL their model list came from (`modelsBase`), so changing the endpoint refreshes the list instead of showing stale names.

## [0.5.0] - 2026-11-10

Multiple image providers, and model discovery.

### Added

- **Several image providers at once.** Settings keeps a list of providers, each with its own name, preset, base URL, model, key and saved model list. Click a chip to switch; the workbench always uses the selected one.
- **检测模型** button: calls `GET {baseUrl}/models`, saves the result on that provider, and turns the model field into a picker. Tolerates the `data[]`, `models[]`, `result.list` and plain-array response shapes.
- Old single-provider configs migrate to a one-item provider list on first read, so nothing needs re-entering.

### Changed

- `publicSettings` strips the key from every provider and returns `hasKey` / `keyHint` per entry, so switching never leaks secrets to the browser.

## [0.4.2] - 2026-11-10

Submit button stays visible, and the community group moved.

### Fixed

- The submit button collapsed to a few pixels and scrolled out of view in editing modes. The composer now lets its children overflow and scroll, and the button sits in a sticky footer so it is reachable in all four modes.

### Changed

- QQ group is now **Modern** (`1132104828`), join link `https://qm.qq.com/q/JdpyCDEUsC`.

## [0.4.1] - 2026-11-10

Source images can come from anywhere.

### Added

- Source panel accepts **local files**, **library picks**, **Ctrl+V paste** and **drag and drop**. The drop zone shows a hint when it is empty and highlights while dragging.
- Pasting in an editing mode adds a source; pasting in Generate mode still adds a reference.

## [0.4.0] - 2026-11-10

Image editing reworked into a mode-based workflow with a full-screen canvas.

### Added

- **创作方式** in the Image Studio composer: 生成 / 编辑 / 扩图 / 局部重绘. The composer swaps its prompt label, placeholder and submit button to match the active mode.
- **源图面板**: pick finished images from the library or local files, keep several sources, and each one carries its own mask, expand and label.
- **全屏图片画布** for inpaint and outpaint:
  - *蒙版 / 擦除* brushes with a size slider, undo and redo.
  - *扩边* with direction (左 / 右 / 上 / 下) and amount (无 / +10% / +25% / +50%); the new region is previewed as a dashed orange band.
  - Zoom in, zoom out, and a fit-to-window default.
  - Apply closes the canvas and returns the mask and expand settings to the composer.

### Changed

- Editing now runs from the composer instead of a one-shot dialog: choose a mode, add sources, paint if needed, then submit.
- The gallery brush button and right-click 局部重绘 / 扩图 add the image as a source and switch to the matching mode.

### Fixed

- The canvas painted to an off-screen buffer, so the source image never appeared.
- The default zoom overflowed the stage, hiding the newly expanded region.
- Edit-mode records were saved as `inpaint`; the mode is now preserved.

## [0.3.5] - 2026-11-09

Voice, community and update check.

### Added

- QQ group entry in the top bar (`741979677`) with a join link and a copy-number button.
- Settings「检查更新」now compares the local version with the latest GitHub Release.
- Voice Studio: local audio history with playback, download and delete; separate voice provider configuration.

### Fixed

- MiniMax T2A v2 endpoints are detected and called with `voice_setting` / `audio_setting`; hex audio is decoded to a real audio file.
- OpenAI-style voice names are mapped to a valid MiniMax `voice_id`.
- Audio MIME types (`.mp3`, `.wav`, `.ogg`, `.opus`, `.aac`, `.flac`, `.pcm`, `.m4a`) are now served correctly, so generated audio plays in the browser.

## [0.3.0] - 2026-11-09

### Added

- **Voice Studio**: text-to-speech through a separately configured OpenAI Audio Speech compatible provider (`POST /audio/speech`), local audio history, playback, download and delete.
- Voice provider settings: base URL, model, key, default voice, output format and extra JSON.
- Sidebar GitHub button that opens the project repository.
- Settings「检查更新」button that compares the local version with the latest GitHub Release.

## [0.2.2] - 2026-11-09

Image workflow and storage update.

### Added

- Reference queue for Image Studio: up to 8 images, Ctrl+V paste, multi-file drop/select, per-image up/down reorder and removal, with「图一 / 图二」labels.
- Multi-reference image edits use ordered `image[]` fields; single references keep the existing `image` field.
- Reuse now carries the original reference images. If the source image had references, a confirmation asks whether to replace the current queue or reuse the prompt only.
- Custom **Library folder**: image/video files can move to another drive. Saving migrates existing files, removes them from the old folder, and rejects invalid, unwritable, nested, or name-conflicting targets.
- Image right-click menu: copy image to clipboard, download original, copy prompt, and open the containing folder (file is selected in Explorer/Finder).
- Settings cleanup: removed the read-only workbench data card; maintenance actions now live under「维护」.

### Fixed

- Workbench height now fills the full DSH panel, including the bottom of the rail and composer.
- Settings copy now distinguishes workbench records from the actual media library folder.

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
