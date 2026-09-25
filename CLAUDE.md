# velumaris-fmod-journals — AI Context

## Purpose
Foundry VTT v14 module for how the Velumaris journals look and work at the table. Part of the
Velumaris ecosystem. The plan, the DM's rulings and the phases live in the vault:
`../velumaris-vault/Ops/Planning/Foundry Journals (Planned).md` (task card
`Ops/Tasks/foundry-journals-refit.md`). Read that before changing behaviour.

**What it does today (0.2.0): the session Table Sheet.** `foundry:table-sheet` in
`../velumaris-utils` pushes three GM-only pages (*At the table*, *Recap*, *Read aloud*), each
wrapped in `<div data-velumaris="table-sheet-NNN[-recap|-read-aloud]" data-vel-meta="{…}">`.
This module finds those wrappers wherever they render (journal windows and GM Screen drawer
cells alike, through a MutationObserver) and builds on them:

- the PC strip list becomes a grid (the list stays the stored text; the grid is built from it)
- secrets get tick boxes, scenes become a tracker (past scenes fold to their title)
- scene lines get map chips from `meta.scenes` (view for the GM; show to players on a 2nd tap)
- names get a hover card (portrait + the NPC note's lead line) and open their NPC page
- spare names become chips the DM taps when one is used; a used name stays lit (the record)
- the spoken pages get boxed read-aloud, and the Read aloud page follows the tracker
- the GM Screen: when the drawer still shows an older session's sheet, the GM is offered a
  one-click repoint (never automatic: the relay may not write world settings)

Look B (DM ruling 2026-09-25): the archives' Cinzel / Outfit / EB Garamond, bundled in
`fonts/` (OFL), dark slate and forge gold, a light counterpart, chosen from the nearest
Foundry theme around the page.

## Rules that are easy to break
- **Never write the stored page.** The look is applied when a page opens. State (ticks, the
  current scene) lives on the entry's flags under this module's id, written with
  `{render: false}` so the journal does not re-render and lose its scroll.
- **`scripts/table-sheet.mjs` is framework-free.** Everything Foundry-shaped goes through the
  `env` object `main.mjs` builds. The review mock in the vault session's scratchpad runs that
  exact file with a fake env, so keep Foundry out of it.
- **The PC strip format is a cross-repo contract.** `parsePcLine()` reads what
  `pcStripBlock()` in `../velumaris-utils/scripts/foundry/table-sheet.js` writes. A line that
  does not parse leaves the whole list untouched, so a format change degrades, never breaks.
- **Never build inside an editor** (`.ProseMirror`, `prose-mirror`, `contenteditable`).
- **Everything is scoped** to `.vel-ts` / `.vel-card`, classes the script adds. With the module
  off, or its client setting "use the new look" unticked, no journal changes.

## Deploying
The Foundry Data folder is bind-mounted into Docker, so a symlink does not reach it. Deploy
with `cd ../velumaris-utils && npm run foundry:deploy-journals` (robocopy /MIR, no build step).
A change is picked up with F5 in each browser. **The first deploy needs `-- --restart`**
(Foundry discovers new module folders only at start), then the DM ticks the module once in
Manage Modules. Tell the other Claude sessions before any restart.

The GitHub release workflow below still works, but the world is served from the robocopy.

## Foundry VTT v14 Notes
- Entry point: `scripts/main.mjs` (ES module, loaded via `esmodules` in manifest)
- Hooks: `Hooks.once("init")` for settings, `Hooks.once("ready")` for everything else
- Module ID: `velumaris-fmod-journals` — namespace for settings and flags
- Core CSS is in cascade layers; this module's CSS is not, so a plain class wins. The doubled
  `.vel-ts.vel-ts` beats the system's more specific journal sheet rules.

## Releasing a New Version (GitHub)
1. Update `module.json` `version` field (the release workflow will also patch it, but keep them in sync)
2. Commit and push your changes
3. Tag and push: `git tag v0.2.0 && git push --tags`
4. `.github/workflows/release.yml` patches `module.json`, zips the module and publishes a Release

## Later phases (see the plan)
- P2: NPC, session, location and faction pages in look A (the archives' ornate frames)
- P3: the Session Guide in Foundry, then encounter guides
- Parked: the June brief (wikilink backlinks, a graph)

## Versioning
Semantic versioning (`MAJOR.MINOR.PATCH`), no pre-release labels (Foundry cannot compare them).
