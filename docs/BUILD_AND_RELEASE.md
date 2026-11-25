# NEXORA — Windows Installer, Auto-Update, First-Run Wizard & Audio Guide

## 1. Building the Windows Installer (`NEXORA-Setup-x64.exe`)

Prerequisites:
- Windows 10/11 x64
- Node.js 20+ and npm
- Rust toolchain (`cargo`) for building `native/rust/target/release/nexora-core.exe`

Build commands:

```powershell
npm install
npm test
npm run dist
```

Output artifacts in `dist/`:
- `NEXORA-Setup-x64.exe` — NSIS graphical installer (custom install directory, desktop shortcut, Start Menu shortcut, uninstaller, preserves `%APPDATA%\nexora` user data)
- `NEXORA-Setup-x64.exe.blockmap` — differential update map used by `electron-updater`
- `latest.yml` — update manifest (version, SHA-512 checksum, release metadata)
- `win-unpacked/NEXORA.exe` — unpackaged staging application directory

> Raw development folders (`3d model nexie`, `real_bac`, `n`, `orb-studio-reference`, `tests`, `docs`, `tools`, `native`, `assets/robot`) are excluded from the package. Unpacked runtime resources include `resources/native/nexora-core.exe` and `resources/app.asar.unpacked/assets/wakeword/*.onnx`.

---

## 2. Windows Code Signing & SmartScreen Notice

Code signing uses standard `electron-builder` environment variables — **never hardcode certificate passwords in source files or `package.json`**:

```powershell
$env:CSC_LINK = "C:\path\to\codesign.pfx"   # or base64-encoded PKCS#12 PFX
$env:CSC_KEY_PASSWORD = "<certificate-password>"
npm run dist
```

Alternative Windows-specific variables (`WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD`) are also supported automatically.

**Unsigned builds:** When `CSC_LINK` / `WIN_CSC_LINK` are not set, `npm run dist` produces an **unsigned** `NEXORA-Setup-x64.exe`. On clean Windows machines, **Microsoft Defender SmartScreen** may show *"Windows protected your PC"* until the binary is signed with an Authenticode code-signing certificate or builds SmartScreen reputation. Unsigned builds are explicitly documented as unsigned.

---

## 3. Publishing Releases & One-Click Auto-Update (`codewithsempai-daya/nexora`)

NEXORA uses `electron-updater` in the main process configured for GitHub Releases (`owner: codewithsempai-daya`, `repo: nexora`).

### Manual or CI Release Workflow
1. Bump version consistently in `package.json` (`version`) and `DEFAULT_CONFIG.version` in `src/main/services/config.js`, then update `CHANGELOG.md`.
2. Run verification:
   ```powershell
   cargo test --manifest-path native/rust/Cargo.toml
   npm test
   ```
3. Publish via git tag (`vX.Y.Z` triggers `.github/workflows/release.yml`) or locally with `GH_TOKEN`:
   ```powershell
   $env:GH_TOKEN = "<github-token-with-repo-write>"
   npm run dist:publish
   ```
4. Verify the GitHub Release contains all 3 required assets:
   - `NEXORA-Setup-x64.exe`
   - `NEXORA-Setup-x64.exe.blockmap`
   - `latest.yml`
5. Ensure the release is published as a **latest stable release** (not Draft or Pre-release), because `UpdaterService` sets `allowPrerelease = false`.

### Update Security & `userData` Preservation
- Update checks and downloads execute strictly inside the Electron main process (`src/main/services/updater.js`), never in the renderer.
- Metadata validates stable semver versions (`> currentVersion`), HTTPS GitHub origin, and SHA-512 binary checksums from `latest.yml` (plus Authenticode publisher signature when installed build is signed).
- Release notes are stripped of HTML tags and rendered safely via `.textContent`.
- Restarts happen **only when the user clicks Update Now** (auto-install on quit is disabled).
- NSIS hooks (`build/installer.nsh`) and `deleteAppDataOnUninstall: false` preserve `%APPDATA%\nexora` (config, `setup.completed`, encrypted `gemini-key.enc`, SQLite memory vault, reminders) across updates.

---

## 4. Audio Isolation & Windows Communications Ducking

### Root Causes Addressed in NEXORA
1. **Chromium/WebRTC Mic Constraints & Loopback Session:** Opening `getUserMedia` with WebRTC `echoCancellation: true` + `autoGainControl: true` and wiring `silentGain -> AudioContext.destination` created an active WebRTC capture+loopback render session that activated Bluetooth HFP / Communications mode and triggered Chromium/Windows volume adjustments.
2. **Independent Capture & Playback Graphs:** Microphone capture now uses `MediaStreamTrackProcessor` (`f32-planar` frames with zero render `AudioContext`) or an isolated `MediaStreamAudioDestinationNode` fallback, with `echoCancellation: false` and `autoGainControl: false` by default and Chromium flags `--disable-features=HardwareMediaKeyHandling,MediaSessionService,WebRtcAllowInputVolumeAdjustment,ChromeWideEchoCancellation`.
3. **Decoupled Playback Limiting:** All assistant sound effects and Gemini voice PCM output share `PlaybackBus` (`src/renderer/audio/playback-bus.js`) with conservative Safe Output Levels (`low`, `medium`, `high`), smooth gain ramping, per-effect independent volumes, overlap debouncing/concurrency caps, and a `DynamicsCompressorNode` peak limiter.

### Windows Communications Ducking (`UserDuckingPreference`)
Windows includes an OS-level setting (**Control Panel -> Sound -> Communications**) that automatically reduces other application audio by 80% or 50% whenever any app opens a Communications capture device (such as Bluetooth Hands-Free HFP).

- **Registry setting:** `HKCU\Software\Microsoft\Multimedia\Audio\UserDuckingPreference` (`3` = *Do nothing*, `1` = *Reduce volume of other sounds by 80%* [Windows default]).
- **NEXORA policy:** NEXORA **never** modifies Windows registry or OS audio settings silently. Instead, **Settings -> Audio and Voice -> Windows Audio Session Isolation** displays the current read-only status and provides a user-controlled **Sound Settings** button (`mmsys.cpl,,3`) so you can select **Do nothing** if Windows or a Bluetooth headset alters background app volume during voice capture.
