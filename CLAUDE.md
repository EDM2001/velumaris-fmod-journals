# velumaris-fmod-journals — AI Context

## Purpose
Foundry VTT v14 module providing an advanced journal system that mimics Obsidian-style linked notes, backlinks, and rich document navigation. Part of the Velumaris ecosystem.

## Goals
- Wikilink-style `[[Note Name]]` linking between journal entries
- Backlinks panel showing which journals reference the current entry
- Graph view or relationship map of journal connections (stretch goal)
- Mirrors the experience of navigating the `velumaris-vault` Obsidian vault inside Foundry

## Foundry VTT v14 Notes
- Entry point: `scripts/main.mjs` (ES module, loaded via `esmodules` in manifest)
- Hooks: use `Hooks.once("init")` for registration, `Hooks.once("ready")` for post-load logic
- Module ID: `velumaris-fmod-journals` — namespace for settings, flags, socket events
- Journal API: `game.journal` — collection of `JournalEntry` documents; pages are `JournalEntryPage` sub-documents
- To extend journal sheets, override `CONFIG.JournalEntryPage.sheetClasses` or use `Hooks.on("renderJournalPageSheet", ...)`
- Settings: register via `game.settings.register("velumaris-fmod-journals", key, options)` in the `init` hook

## Local Development
1. Symlink this folder into Foundry's module directory:
   ```
   mklink /D "C:\Users\<you>\AppData\Local\FoundryVTT\Data\modules\velumaris-fmod-journals" "C:\code\projects\velumaris-fmod-journals"
   ```
2. Enable the module in Foundry's **Add-on Modules** settings for your world
3. F5 in the browser to reload after code changes (no build step needed for plain ES modules)

## Releasing a New Version
1. Update `module.json` `version` field (the release workflow will also patch it, but keep them in sync)
2. Commit and push your changes
3. Tag and push:
   ```
   git tag v0.2.0
   git push --tags
   ```
4. The GitHub Actions workflow (`.github/workflows/release.yml`) automatically:
   - Patches `module.json` with the new version and versioned download URL
   - Zips the module
   - Creates a GitHub Release with `module.json` and the zip as public assets

Foundry fetches the manifest from the `releases/latest/download/module.json` URL and compares versions to determine if an update is available.

## Sibling Projects
- `velumaris-fmod-theatre` — theatre and stage presentation module
- `velumaris-utils` — shared DM automation utilities and Foundry macros
- `velumaris-archives` — Astro Starlight campaign wiki
- `velumaris-vault` — Obsidian campaign vault (source of truth for journal data this module mirrors)
- `velumaris-oidc-bridge` — Cloudflare Worker OIDC/OAuth2 identity bridge
- `velumaris-discord` — Discord bot integration

## Versioning
Uses semantic versioning (`MAJOR.MINOR.PATCH`). Do not use pre-release labels (e.g., `-beta`) — Foundry's version comparison does not support them.
