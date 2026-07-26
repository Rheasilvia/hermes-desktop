# Hermes Desktop Release Process

This document describes the release workflow for the Hermes Desktop application using Tauri's built-in updater.

## Overview

The Tauri updater plugin checks GitHub Releases for new versions. When a new release is published, the app detects it and shows an update banner to users.

## Release Workflow

### 1. Version Bump

Update the version in both places:

```bash
# desktop/src-tauri/Cargo.toml
version = "X.Y.Z"   # bump this

# desktop/src-tauri/tauri.conf.json
"version": "X.Y.Z"  # must match Cargo.toml
```

### 2. Tag and Create GitHub Release

```bash
git tag -a vX.Y.Z -m "Release vX.Y.Z"
git push origin vX.Y.Z
```

The CI pipeline (configured in `.github/workflows/`) will automatically:

1. Build the Tauri application for all platforms (Linux, macOS x86_64, macOS aarch64, Windows)
2. Upload the artifacts to the GitHub Release

### 3. Generate the Update Manifest

After the CI builds complete and artifacts are uploaded, generate `desktop/scripts/update-manifest.json`:

```bash
node -e "
const manifest = {
  version: 'X.Y.Z',
  notes: 'Release notes for vX.Y.Z',
  pub_date: new Date().toISOString(),
  platforms: {
    'linux-x86_64': { url: 'https://github.com/nousresearch/hermes-agent/releases/download/vX.Y.Z/hermes_X.Y.Z_amd64.AppImage' },
    'darwin-x86_64': { url: 'https://github.com/nousresearch/hermes-agent/releases/download/vX.Y.Z/hermes_X.Y.Z_x64.dmg' },
    'darwin-aarch64': { url: 'https://github.com/nousresearch/hermes-agent/releases/download/vX.Y.Z/hermes_X.Y.Z_aarch64.dmg' },
    'windows-x86_64': { url: 'https://github.com/nousresearch/hermes-agent/releases/download/vX.Y.Z/hermes_X.Y.Z_x64-setup.exe' }
  }
};
require('fs').writeFileSync('desktop/scripts/update-manifest.json', JSON.stringify(manifest, null, 2));
"
```

Then commit and push the manifest:

```bash
git add desktop/scripts/update-manifest.json
git commit -m "chore: add update manifest for vX.Y.Z"
git push origin main
```

### 4. Tauri Updater Serves Manifests

Tauri will automatically serve the manifest from the configured endpoint:

```
https://github.com/nousresearch/hermes-agent/releases/latest/download/latest.json
```

This is configured in `tauri.conf.json` under `plugins.updater.endpoints`.

## Signed Updates (Future)

Currently, the updater is configured with an empty `pubkey` placeholder. To enable signed updates:

1. Generate an Ed25519 key pair for signing updates
2. Set `plugins.updater.pubkey` in `tauri.conf.json` with the public key
3. Sign each release artifact with the private key before upload
4. Update the manifest generation script to include signatures

## Artifacts

Each release should contain:

| Platform | Artifact Name | Format |
|----------|--------------|--------|
| Linux | `hermes_X.Y.Z_amd64.AppImage` | AppImage |
| macOS x86_64 | `hermes_X.Y.Z_x64.dmg` | DMG |
| macOS aarch64 | `hermes_X.Y.Z_aarch64.dmg` | DMG |
| Windows | `hermes_X.Y.Z_x64-setup.exe` | NSIS Installer |

## Manual Testing

To test the updater locally:

```bash
# Start the dev server
cd desktop && npm run tauri:dev

# Or build and run
cd desktop && npm run tauri:build
./desktop/src-tauri/target/release/hermes-desktop
```

The app will check for updates on launch and display a banner if one is available.
