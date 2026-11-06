# Security Policy

## Supported versions

| Version | Supported |
| --- | --- |
| 0.1.x | Yes |

## Reporting a vulnerability

Please **do not** open a public issue for a vulnerability. Use the repository's **Security → Report a vulnerability** (GitHub Security Advisories) so the report stays private until a fix is ready.

Include the version, a minimal reproduction, the affected endpoint or file, and whether an API key or local file could be exposed. We aim to acknowledge reports within a few days.

## Security model

- API keys for image/video providers are stored only in `$DSH_HOME/media-workbench-modern/settings.json` with mode `600`. They are never returned to the browser; the UI receives only `hasKey` and the last four characters.
- Writing uses the DSH-selected model. The plugin does not store DSH credentials.
- Every write request checks the DSH connection service and same-origin `Origin`/`Sec-Fetch-Site` headers.
- Static files are served from a whitelist under `web/`; generated files are served only from `files/` with a strict file-name pattern.
- Remote image/video URLs are checked before download and private, loopback, link-local and cloud-metadata addresses are rejected.
- Imported Star Maps are normalized: unknown node types, dangling/duplicate/type-incompatible/cyclic edges, and oversized collections are dropped.
- The plugin has no telemetry and makes no network request except to the provider endpoints and media URLs the user configured.

## User responsibilities

- Treat provider API keys as secrets; do not paste them into issue reports, screenshots or prompts.
- Review a Star Map before running it if it was imported from an untrusted source.
- Provider-side retention, pricing and content policies are outside this plugin's control.
