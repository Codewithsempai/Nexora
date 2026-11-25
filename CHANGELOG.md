# Changelog

## 0.4.0 — Phase 3: ship-ready (2026-11-25)

**Packaging and releases**
- Windows installer via electron-builder (`npm run dist`), wake-word models and worker unpacked from the archive.
- Optional auto-update through GitHub Releases (installed builds only, toggle in Settings -> Support & Updates).
- GitHub Actions: `ci.yml` (tests on Windows, Node 20 and 22) and `release.yml` (tag `vX.Y.Z` builds and publishes the installer).
- One version number: `package.json` is the source; `npm run version:sync` updates README badge and Cargo files; `npm test` fails on drift. The Settings screen and default config now read the real version.

**Reliability and support**
- Rotating log file (`%APPDATA%\nexora\logs`, 3 x 1 MB) with API keys, tokens and `?key=` URLs removed; uncaught errors are logged.
- Settings -> Support & Updates: **Export report** (versions, settings without secrets, recent log) and **Open logs folder**.
- `NEXORA_USER_DATA` environment variable points the app at a separate data folder (used by the end-to-end test).

**Memory**
- Better recall: BM25 ranking, typo-tolerant trigram matching and an English/Tanglish synonym map (offline; not neural embeddings). Used by memory search and by the context sent to Gemini.
- Memory **Import** (merge, skips duplicates, validates every note) next to the existing Export.

**Docs and housekeeping**
- `SECURITY.md` placeholder removed (private reporting via GitHub), `PRIVACY.md` covers update checks, logs and diagnostics.
- New `docs/architecture/ARCHITECTURE.md`; older phase reports marked historical.
- New tests: memory search/import, logger/redaction, version sync, updater, packaging; Playwright smoke test (`npm run test:e2e`).

## 0.3.25
Offline ONNX wake word, Orb Studio fixes. See `docs/history/` for earlier notes.
