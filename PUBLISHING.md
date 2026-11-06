# Publishing

This repository is ready to publish as an npm package and as a GitHub repository. Replace `<you>` with your GitHub account or organisation.

## 1. Preflight

```bash
npm test
npm pack --dry-run
```

Check that the package contains only `src/`, `lib/`, `web/`, `docs/`, the patch file, README/LICENSE and changelog/security docs. `release/`, `.shots/`, `.dev-home/`, `node_modules/` and development scripts in `tools/` are excluded by `package.json` `files`.

The npm name `@modern/dsh-media-workbench` was available on 2026-11-07. Verify again before publishing:

```bash
npm view @modern/dsh-media-workbench version
```

If it is taken, either rename the package and `cordis.patch.yml` `name`, or publish under another scope such as `@your-scope/dsh-media-workbench`.

> **Scope ownership:** publishing `@modern/...` requires your npm account to be a member of the `@modern` org (or to own that scope). A 404 from `npm view` only means the package is free; it does not prove you can publish under the scope. If `npm publish` returns 403, use your own scope instead and update the package name in **all four** places: `package.json` `name`, `cordis.patch.yml` `name`, `src/index.js` `export const name`, and `lib/client.js` `id` (the browser module id must equal the package name).

## 2. Repository metadata

Already set in `package.json` to `https://github.com/ExcCoder/modern-dsh-media-workbench`. If the repository moves, update:

```bash
npm pkg set repository.type=git repository.url=git+https://github.com/ExcCoder/modern-dsh-media-workbench.git homepage=https://github.com/ExcCoder/modern-dsh-media-workbench#readme bugs.url=https://github.com/ExcCoder/modern-dsh-media-workbench/issues
```

## 3. GitHub repository

The repository already exists at `https://github.com/ExcCoder/modern-dsh-media-workbench` with `master` as its default branch. To publish a new snapshot:

```bash
git clone https://github.com/ExcCoder/modern-dsh-media-workbench.git
cd modern-dsh-media-workbench
# copy the plugin source into this directory
git add .
git commit -m "release: v0.1.1"
git push origin master
```

Then in the repository settings:

- enable Issues and Discussions if you want community support;
- enable private vulnerability reporting under **Security**;
- add topics: `dsh`, `deepseek-harness`, `dsh-plugin`, `image-generation`, `writing`, `ai`.

## 4. Publish to npm

```bash
npm login
npm publish --access public
```

The package has no runtime dependencies, so the tarball is around 300 KB (mostly screenshots).

After publishing, install with:

```bash
dsh plugin --profile desktop add @modern/dsh-media-workbench
```

Users must fully restart DSH after installing a new plugin.

## 5. Create a GitHub release

Use the version as the tag (`v0.1.1`), copy the matching section of `CHANGELOG.md` into the release notes, and attach the artifacts from `release/`:

- `modern-dsh-media-workbench-0.1.1.tgz`
- `modern-dsh-media-workbench-0.1.1-source.zip`
- `modern-dsh-media-workbench-0.1.1-source.tar.gz`
- `SHA256SUMS.txt`

## 6. Release checklist

- [ ] `npm test` passes
- [ ] `npm pack --dry-run` contains no secrets, local paths, screenshots of private data or `release/`
- [ ] version bumped in `package.json` and `CHANGELOG.md`
- [ ] `repository`, `homepage`, `bugs` point at the public repository
- [ ] README install command and screenshots render on GitHub
- [ ] npm tarball installs into a scratch DSH profile and the sidebar entry appears
- [ ] GitHub release artifacts and checksums uploaded
