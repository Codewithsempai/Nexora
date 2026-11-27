# Changelog

## 0.4.2 - update flow check (2026-11-27)

- Second test release: confirms that 0.4.1 finds, downloads and installs an update from GitHub Releases.
- Release builds now check line endings, so the Windows CI no longer fails on CRLF checkouts (`.gitattributes`).

## 0.4.1 - test update (2026-11-27)

- Test release to check the update badge.

## 0.4.0 — Phase 3: ship-ready (2026-11-25)

**Packaging and releases**
- Windows installer via electron-builder (`npm run dist`), wake-word models and worker unpacked from the archive.
- Optional auto-update through GitHub Releases (installed builds only, toggle in Settings -> Support & Updates).
- GitHub Actions: `ci.yml` (tests on Windows, Node 20 and 22) and `release.yml` (tag `vX.Y.Z` builds and publishes the installer).
- One version number: `package.json` is the source; `npm run version:sync` updates README badge and Cargo files; `npm test` fails on drift. The Settings screen and default config now read the real version.

**Updates you can see**
- **Update badge** in the title bar ("Update available", then "Updating 40%" and "Restart to update"). Click it to open Settings -> Support & Updates.
- **What's new** popup after an update, written from this file (shown once per version).
- **Skip this version** in Settings and in the update toast; skipped versions stay quiet until a newer one appears ("Check for Updates" still shows them).
- Say or type **"Nexora, check for updates"** (also "any updates?", "am I up to date?"); the result also appears as a toast.
- One updater: `updater.js` is the one that runs; `update-checker.js` is only its read-only helper for dev builds (its dev-build path now works).

**Setup**
- The Wake Word step now shows the wake-up commands ("Hey NEXORA", "NEXORA"), what you can say after them, and an Enable switch with a clear note when it is off.

**Reliability and support**
- Rotating log file (`%APPDATA%\nexora\logs`, 3 x 1 MB) with API keys, tokens and `?key=` URLs removed; uncaught errors are logged.
- Settings -> Support & Updates: **Export report** (versions, settings without secrets, recent log) and **Open logs folder**.
- `NEXORA_USER_DATA` environment variable points the app at a separate data folder (used by the end-to-end test).

**Memory**
- Better recall: BM25 ranking, typo-tolerant trigram matching and an English/Tanglish synonym map (offline). Used by memory search and by the context sent to Gemini.
- **Smarter recall (by meaning)**: notes are embedded with the Gemini embedding model (your key) and matched together with the keyword ranking, so "what do I do to relax?" finds "enjoys chess". Vectors are cached encrypted next to the vault; any failure falls back to keyword recall. Switch: Settings -> Memory Vault -> Smarter recall. Sends note text to Google, see `PRIVACY.md`.
- Memory **Import** (merge, skips duplicates, validates every note) next to the existing Export.

**Docs and housekeeping**
- `SECURITY.md` placeholder removed (private reporting via GitHub), `PRIVACY.md` covers update checks, logs and diagnostics.
- New `docs/architecture/ARCHITECTURE.md`; older phase reports marked historical.
- New tests: memory search/import, logger/redaction, version sync, updater, packaging; Playwright smoke test (`npm run test:e2e`).

## 0.3.25
Offline ONNX wake word, Orb Studio fixes. See `docs/history/` for earlier notes.
