# Velumaris: Journals

An advanced journal system for Foundry VTT v14 that mimics Obsidian-style linked notes, backlinks, and rich document navigation for the Velumaris campaign setting.

## Features (Planned)

- Wikilink-style `[[Note Name]]` linking between journal entries
- Backlinks panel — see which journals reference the current entry
- Graph view of journal relationships

## Install

In Foundry VTT, go to **Add-on Modules → Install Module** and paste the manifest URL:

```
https://github.com/EDM2001/velumaris-fmod-journals/releases/latest/download/module.json
```

## Compatibility

| Foundry VTT | Status |
|-------------|--------|
| v14         | Verified |

## Releasing a New Version

1. Commit and push your changes
2. Tag the release and push the tag:
   ```
   git tag v1.2.3
   git push --tags
   ```
3. GitHub Actions will automatically patch `module.json` with the new version, zip the module, and publish a GitHub Release with both files as public assets — Foundry will detect the update via the manifest URL.

## Development

See [CLAUDE.md](CLAUDE.md) for local setup details.

## License

All rights reserved.
