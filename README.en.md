# Modern-MediaStudio · @exccoder/dsh-media-workbench

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) plugin that adds a **Modern-MediaStudio** to the sidebar with five connected workbenches:

- **Image Studio** — prompt to image, nine style presets, six aspect ratios, a reference queue of up to 8 images, favorites and history.
- **Writing Studio** — local document library, selection-aware continue / polish / expand / rewrite / outline / title, streaming output.
- **Star Map** — a typed DAG of prompt, writing, image, video and preview nodes; cycle checks, parallel topological execution, templates and reusable blueprints.
- **Video Studio** — text-to-video, image-to-video, and a **Storyboard** mode that turns four keyframes into a moving preview without a video provider.
- **Voice Studio** — text-to-speech with a separately configured OpenAI Audio Speech compatible provider, local playback and downloads.

Writing uses DSH's currently selected model. Image, video and voice providers are configured separately. All works, images, videos and Star Maps stay on this machine. The UI is available in Chinese and English and follows DSH's language and light/dark theme.

[中文说明](README.md)

## Install

Requires DSH `0.2.x` (verified on `0.2.2-rc.1`).

```bash
# after the package is published
dsh plugin --profile desktop add @exccoder/dsh-media-workbench

# or from a local checkout
dsh plugin --profile desktop add /absolute/path/to/dsh-media-workbench
```

You can also use **Plugins → Add plugin** in DSH and point it at the directory or a packed `.tgz`. Fully quit and reopen DSH after installing; the sidebar entry should then appear.

## Configure

Open **Modern-MediaStudio → Settings**.

### Image provider

Any service compatible with the OpenAI Images API works:

- generate: `POST {baseUrl}/images/generations`
- edit with a reference image: `POST {baseUrl}/images/edits` (multipart, field `image`)

**Several providers can be stored at once** — for images, video, voice and writing alike. In settings, hit **New** and fill in the URL and key; each entry keeps its own name, base URL, model, key and saved model list, and clicking a chip switches the active one. The studio always uses the selected provider. Old single-provider configs are migrated into a one-item list on first read.

Writing is the exception worth knowing: leave it empty and it uses the current DSH model at no extra cost; configure a provider and it calls that endpoint's `/chat/completions` instead.

Model names don't have to be typed: save the URL and key and the list is fetched from `GET {baseUrl}/models`, shown as clickable chips — pick one and it takes effect. It refetches on save when the list is empty or the URL changed. If the endpoint doesn't expose models, the text field still accepts a name.

Presets are included for OpenAI, SiliconFlow, Zhipu BigModel and Volcano Ark. Responses in `data[0].b64_json` and `images[0].url` shapes are supported. Use **Test image** to verify the endpoint.

Reference images can be dropped, multi-selected or pasted with **Ctrl+V**, up to 8 at a time, labelled 图一 / 图二 and reorderable.

Finished images can be edited further. The composer's **Mode** switch has four positions: **Generate** (a new image from the prompt), **Edit** (rewrite the whole source), **Outpaint** (grow content past an edge), and **Inpaint** (paint an area red and change only that).

All three editing modes need a **source** first — choose a local file, pick one from the library, drop files onto the panel, or paste with **Ctrl+V**. The brush icon on a gallery image adds it as a source too. Each source carries its own mask, expand setting and label, and you can queue several.

**Edit selected** opens a full-screen canvas: mask and erase brushes with size control, undo and redo; expand with a direction and amount (+10% / +25% / +50%) previewed as a dashed orange band; zoom that fits the window by default. **Apply** returns the mask and expand settings to the composer, where you write what should change and submit.

Cropping, masking and compositing run in the browser, so the model only regenerates the selected region and pixels outside it are never touched.

### Video provider

The adapter expects the common asynchronous shape:

```text
POST {baseUrl}{createPath}          -> task id
GET  {baseUrl}{statusPath}          -> queued / in_progress / completed / failed
GET  {baseUrl}{contentPath}         -> video bytes (or a URL in the status response)
```

`{id}` is replaced with the task id. Both paths are configurable. If you do not have a video provider, switch to **Storyboard**: it generates four keyframes with the image provider and plays them in the browser.

### Writing

No extra key. Writing uses the model selected in DSH. The plugin does not store DSH credentials.

## Data and security

- Data directory: `$DSH_HOME/media-workbench-modern/` (defaults to `~/.dsh/media-workbench-modern/`)
  - `state.json` — images, videos, documents, Star Maps, blueprints
  - `settings.json` — provider endpoints, model names and keys, mode `600`
  - `files/` — generated media and uploaded references
- Provider keys never reach the browser; the UI only receives `hasKey` and the last four characters.
- Write routes validate the DSH connection service and same-origin headers. Static files are whitelisted. Generated files use a strict name pattern.
- Remote image/video URLs are checked before download; loopback, private, link-local and metadata addresses are rejected.
- Imported Star Maps are normalized: unknown nodes, dangling/duplicate/type-incompatible/cyclic edges are dropped.

See [SECURITY.md](SECURITY.md) for the full model.

## Model tools

The plugin registers five tools so DSH can use the workbench from a conversation:

| Tool | Purpose |
| --- | --- |
| `modern_media_generate_image` | Generate 1–2 images into the image history and return local paths |
| `modern_media_save_document` | Save a manuscript into Writing Studio |
| `modern_media_generate_video` | Generate a video or Storyboard, waiting by default |
| `modern_media_run_star_map` | Run an existing Star Map or create one from a template and run it |
| `modern_media_workspace_overview` | List recent images, videos, documents and Star Maps |

## Development

```bash
node tools/dev-server.mjs     # standalone preview, http://127.0.0.1:7788/media-workbench-modern/
node --test tools/verify.mjs  # offline tests: DAG, import repair, storage, key masking, prompts
npm pack                      # build an installable .tgz
```

The preview does not start DSH and needs no keys: image/video use local mocks and writing uses a mock stream. Preview data lives in `.dev-home/`.

```text
src/           host half: routes, storage, providers, writing prompts, Star Map execution, model tools
lib/client.js  browser half: sidebar entry + iframe panel
web/           workbench UI as native ES modules (no build step)
tools/         standalone preview and offline tests
```

## Known limitations

- Video provider APIs differ; the generic adapter may need custom paths or extra JSON for a specific vendor.
- Without a video provider there is no local mp4 encoding — Storyboard is the fallback.
- One active image provider configuration (no multi-key rotation).
- Narrow layouts collapse the document list, node palette and inspector.

## License

MIT. Not affiliated with DeepSeek; DSH names and marks belong to their owners.
