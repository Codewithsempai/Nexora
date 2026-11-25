# NEXORA Phase 3 — Gemini Model Ladder, Live Voice & Wake Standby

## Base and reference

- Updated base: `NEXORA_Phase2_streaming_memory_build(1).zip` / existing Phase 3 continuation project.
- Reference: `Nexora_until_done.zip`, consulted for the older Gemini model ladder, Live voice flow, wake phrase handling, mute-to-standby behavior and floating Orb popup. The reference project was not copied wholesale.
- Kept the target project's Electron main/preload/renderer architecture, current Orb engine and three Orb profiles, chat, encrypted Memory Vault, SFX, Rust sidecar and panel layout.

## Implemented in this update

### 1. Dynamic Gemini model directory and fallback ladders

- Added `src/main/services/model-ladder.js`.
- Discovers the models available to the saved API key through the Gemini `models.list` endpoint and filters them by supported generation method:
  - Text/wake classification: `generateContent`.
  - Live voice: `bidiGenerateContent`.
- Uses the user's selected model first, then eligible models ordered by model family and capability.
- Built-in text fallback ladder if discovery is unavailable: `gemini-3.8-flash`, `gemini-3.7-flash`, `gemini-3.6-flash`, `gemini-3.5-flash`, `gemini-3.5-flash-lite`, `gemini-3.1-flash-lite`, `gemini-3.1-pro-preview`, `gemini-3-flash-preview`.
- Built-in Live fallback ladder if discovery is unavailable: `gemini-3.8-live`, `gemini-3.8-live-extended-thinking`, `gemini-3.1-flash-live-preview`.
- Error-aware cooldowns:
  - Missing/unsupported model: 30 minutes.
  - Quota/rate limit: 10 minutes.
  - Server/high demand and timeout: 2 minutes.
  - Invalid key/permission and network-offline failures do not trigger futile model switches.
- Model-list discovery is cached for ten minutes and bounded by per-page timeouts. The API key is only represented in memory by a SHA-256 cache fingerprint; it is never saved by the model directory.
- Settings now displays discovered text and Live model choices, refresh controls and fallback availability/cooldown status. A saved model remains selected even if it is no longer listed; the runtime ladder will attempt it once, classify the failure and fall back.

### 2. Normal Gemini chat model switching

- Both compatibility `chat:generate` and streaming `chat:stream` use the text-model ladder.
- HTTP errors and Gemini SSE error events (including quota/high-demand errors delivered after an HTTP 200) are classified and can switch to the next eligible model before any text has been emitted.
- Once streamed text has begun, the request does not restart on another model, preventing duplicated answers. The partial response is retained and an error is shown instead.
- Model switches are sent to the renderer and displayed in the Chat header.

### 3. Gemini Live model ladder

- Live tries the selected model first, then other discovered `bidiGenerateContent` models; if model discovery is unavailable it uses the built-in Live ladder.
- Setup errors (unsupported model, quota, high demand, timeout) move to the next model.
- Unexpected runtime Live failures also make one bounded pass through remaining non-cooled-down models for the current Live session.
- WebSocket HTTP handshake responses and server error payloads retain their status/message for classification.
- Live model switches are reflected in Settings voice status.
- The preferred model remains `gemini-3.8-live`, with `Charon` voice by default.

### 4. Wake-word standby

- Wake standby remains explicitly opt-in and is restored after launch only when the user previously enabled it.
- Supported phrases: **“Hey Nexora”, “Nexora”, “Hey Nexo”, “Nexo”**. The classifier also accepts the documented “next ora” pronunciation.
- Wake-word classification uses the same normal-text model ladder and only sends short audio segments while wake standby is enabled.
- Clips are transient in NEXORA memory and are not written to disk. Wake recognition is cloud-based, not offline.
- On wake, NEXORA opens the existing transparent floating Orb popup and starts a Gemini Live session.

### 5. Mute-to-standby behavior

- The Live transcription handler no longer depends on Gemini sending the optional `finished` flag. It merges cumulative/overlapping transcript fragments and flushes on explicit completion, server non-speech state, turn completion or a short post-speech quiet window.
- A short, explicit **“mute”** command (also supported with NEXORA/Tanglish polite forms such as “Nexora mute pannunga”) stops Live output and closes the current Live session.
- When wake standby was enabled, the microphone capture remains active, the popup returns to the idle Orb and NEXORA remains in `standby` so the four wake phrases can start Live again.
- The word “standby” by itself is not treated as a mute command. Phrases such as “mute volume” are not treated as Live-stop commands.
- If wake standby was not enabled, muting a manually started Live session stops microphone capture and returns to offline.

### 6. Microphone privacy and cleanup

- A failed manual Live connection releases microphone capture unless wake standby is explicitly enabled.
- Failed wake-standby restoration also releases capture instead of leaving the microphone open.
- Turning Mic Off disables standby, closes Live, stops capture/playback and hides the popup.
- API keys remain in Electron secure storage and do not enter renderer code.

## Tests run

- `npm test` — **passed 9/9 suites**:
  - Orb state/config/IPC contracts.
  - Gemini request/SSE parsing.
  - Encrypted Memory Vault.
  - PCM/WAV and wake-clip detection.
  - All four requested wake phrases.
  - Strict mute-to-standby command handling, including “standby” alone and “mute volume” negative cases.
  - Transcript fragment merging.
  - Dynamic text and Live model discovery, ordering, cooldown and failure classification.
  - High-demand SSE error handling.
- JavaScript syntax checks — all project `.js` files passed `node --check`.
- ZIP CRC/integrity check — run on the final source archive.

## Requires user setup / not verified here

- Run `npm install` and save a valid Gemini API key in NEXORA Settings.
- The models shown in Settings depend on the API key's actual model entitlements and the Gemini API endpoint. Google's current Gemini API model pages list Gemini 3.8 Flash and Gemini 3.8 Live models; some keys/accounts may expose a different supported set. The app filters its ladder using the list returned for that key.
- End-to-end Gemini API calls, Live audio round-trips, wake accuracy, mute recognition and floating Orb placement require Windows/Electron testing with the user's API key and microphone. No API key is included in the ZIP.
- This adds bounded model failover, not an unlimited unattended network reconnection loop. If network access is lost, Live stops and returns to standby (when enabled) or error/offline (when not enabled).

## Run

```powershell
npm install
npm test
npm start
```

1. Open Settings and save a Gemini API key.
2. Click **Refresh Models** to inspect models available to that key.
3. Choose the preferred Normal AI and Live model; fallback is automatic.
4. Click **Enable Wake** once to grant microphone access and opt in to standby, or click **Start Live** for a manual session.
5. With wake standby enabled, say **Hey Nexora**, **Nexora**, **Hey Nexo** or **Nexo**. During Live, say **mute** to return to standby. **Turn Mic Off** disables standby completely.
