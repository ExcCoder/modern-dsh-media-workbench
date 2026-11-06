# Modern-MediaStudio · @modern/dsh-media-workbench

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) plugin that adds a **Modern-MediaStudio** to the sidebar with four connected workbenches:

- **Image Studio** — prompt to image, nine style presets, six aspect ratios, reference-image editing, favorites and history.
- **Writing Studio** — local document library, selection-aware continue / polish / expand / rewrite / outline / title, streaming output.
- **Star Map** — a typed DAG of prompt, writing, image, video and preview nodes; cycle checks, parallel topological execution, templates and reusable blueprints.
- **Video Studio** — text-to-video, image-to-video, and a **Storyboard** mode that turns four keyframes into a moving preview without a video provider.

Writing uses DSH's currently selected model. Image and video providers are configured separately. All works, images, videos and Star Maps stay on this machine. The UI is available in Chinese and English and follows DSH's language and light/dark theme.

Inspired by the creative space in [LevelUpAgent](https://github.com/TippingGame/LevelUpAgent); this is an original implementation for DSH's plugin system.

[中文说明](README.md)

## Install

Requires DSH `0.2.x` (verified on `0.2.2-rc.1`).

```bash
# after the package is published
dsh plugin --profile desktop add @modern/dsh-media-workbench

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

Presets are included for OpenAI, SiliconFlow, Zhipu BigModel and Volcano Ark. Responses in `data[0].b64_json` and `images[0].url` shapes are supported. Use **Test image** to verify the endpoint.

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
- If an earlier build used the old directory `~/.dsh/levelup-workbench/`, its settings, works and files are copied once into the new directory on first start. The old directory is kept as a backup and can be deleted after verification.
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
