# NEXORA architecture (v0.4)

Electron app, Windows first. Three layers: a **main process** that owns every privilege, a **preload bridge** that exposes a fixed list of IPC calls, and a **renderer** (plain JS panels + Three.js orb) that has no Node access.

```
renderer (src/renderer)  --window.nexoraAPI-->  preload (src/preload)  --ipcRenderer.invoke-->  main (src/main)
 panels: chat, memory, reminders,              contracts/api.js lists every           ipc/ipc-handlers.js
 settings, status, autonomy, orb               allowed channel                        checks isTrustedRenderer() on each call
```

## Main process (`src/main`)
| Area | Files | Job |
|---|---|---|
| Startup | `application/app.js`, `window.js`, `popup-window.js` | single-instance lock, data folder (`%APPDATA%\nexora`, or `NEXORA_USER_DATA`), logger, updater, windows |
| IPC | `ipc/ipc-handlers.js` | every renderer request; untrusted senders are refused |
| Chat and models | `services/model-ladder.js`, `model-health.js` | Gemini model fallback with cooldowns |
| Voice | `services/voice-service.js`, `wakeword-*.js`, `onnx-lite.js` | Gemini Live session; offline ONNX wake word in a worker thread (in-process fallback) |
| Memory | `services/memory-store.js`, `memory-search.js`, `memory-learner.js` | encrypted vault, BM25 + fuzzy recall, import/export, fact extraction |
| Reminders | `services/reminder-service.js`, `application/reminder-alert.js` | schedule, toast, popup orb |
| Autonomy | `autonomy/*` | action registry, risk policy, approval cards, action log |
| Support | `services/logger.js`, `diagnostics.js`, `updater.js`, `config.js` | redacted rotating log, support report, GitHub update check, settings |
| Native | `services/sidecar.js`, `native/rust` | optional Rust helper (diagnostics, math); the app runs without it |

## Data on disk (`%APPDATA%\nexora`)
`config.json` settings (no secrets) · encrypted Gemini key · encrypted memory vault (+`.bak`, + `.vec` recall index) · reminders · autonomy action log · `logs/nexora.log[.1,.2]`.

## Security rules that hold everywhere
- Renderer: `contextIsolation` on, no Node integration; only `window.nexoraAPI` exists.
- Every IPC handler calls `isTrustedRenderer(event)`; new channels must be added to `contracts/api.js` (a test checks the wiring).
- The Gemini key never reaches the renderer; the Live WebSocket URL contains it, so logs pass through `redact()`.
- Autonomy actions are classified by risk; anything risky needs an approval card.

## Build and release
`npm test` -> unit suites + version-drift check. `npm run dist` -> `dist/NEXORA-Setup-x64.exe` (+ `latest.yml`). Tag `vX.Y.Z` -> `release.yml` builds and publishes with an update feed. `npm run test:e2e` launches the real app against a temporary data folder.

## Not covered yet
macOS/Linux, a fake-Gemini server for end-to-end voice tests, an offline (on-device) embedding model for memory, bundling the Rust sidecar in the installer.
