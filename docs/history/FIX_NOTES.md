# v0.3.25 — Offline ONNX wake word, orb size fix, readability fixes
- **Wake word is now 100% offline.** The old path (record a clip, send it to Gemini speech-to-text / a throwaway Live session, string-match the transcript) is gone. `assets/wakeword/` holds `hey_nexora`, `hey_nexo`, `nexora`, `nexo` ONNX heads plus openWakeWord's shared `melspectrogram.onnx` + `embedding_model.onnx`. Pipeline: mic PCM -> mel -> 96-d embedding -> 16-frame classifier (see `wakeword-onnx.js`). Gemini is used only AFTER the wake phrase, for the Live conversation. Wake standby no longer needs an API key to start.
- **No native modules / npm install.** `onnx-lite.js` is a dependency-free ONNX executor (22 ops). Verified against onnxruntime: scores match to ~1e-7, embeddings to ~4e-5. The embedding CNN is streamed incrementally (only the 8 new frames per 80 ms step), about 14 ms per step in the test sandbox. Runs in a worker thread (`wakeword-worker.js`), falling back to in-process.
- **Settings > Voice**: *Wake sensitivity* slider (`voice.wakeThreshold`, default 0.6, applies live). Privacy note now says wake audio stays on the PC. `voice.wakeEngine` removed.
- Any extra openWakeWord-style `*.onnx` head dropped into `assets/wakeword/` is loaded automatically.
- Removed with the online path: hands-free "OK / allow" approval answers while only in standby (they relied on transcribing standby audio). They still work during Live.
- **Orb / Robot size buttons did nothing**: a later glass rule forced `.orb-canvas-container` to `width:100%; height:72%; max-width:520px !important`, overriding `--orb-preview-size`. The variable now wins in the Orb panel (stays centred beside Orb Studio) and drives the Core orb once a size has been chosen.
- Dropdown lists (`select option`) were light grey with white text: now dark with light text (`color-scheme: dark`). Model-ladder summary no longer clips to one scrolling line. Send paper-plane optically centred.

# v0.3.24 — Live render quality, Orb Studio panels, composer polish
- **Robot quality**: the old pipeline capped the robot's WebGL buffer at 320 px, had multisampling off, `mediump` shaders and a 0.9 pixel ratio (below 1:1 = blurry), then scaled it up. Replaced with four real tiers (`PERFORMANCE_PROFILES` in `orb-engine.js`): Low / Medium / High / Very High, each setting FPS cap, pixel-ratio cap, buffer cap, supersampling (up to 2x), hardware MSAA, studio reflection environment strength, anisotropic filtering and shader precision.
- **Live switching**: `OrbEngine.setPerformanceMode()` pushes the tier to `RobotOrb.setQuality()`; it applies on the next frame (the WebGL renderer is rebuilt only when MSAA/precision change). The popup Orb picks it up through the existing `popup:init` refresh.
- **Orb Studio** is now split into panels behind a tab bar: Orb / Quality / Robot / Popup (the Robot tab only shows for the robot Orb; the last tab is remembered). Robot Studio sections are collapsible.
- **Quality panel**: four buttons plus live stats (FPS, render size, edge smoothing, supersampling, reflections). Stays in sync with Settings > Performance in both directions and persists to `performance.mode`.
- **Composer**: placeholder moved slightly left; send button has a hover animation (lift, glow ring, arrow fly-through, press squish); hover/focus glow on the pill. Honors `prefers-reduced-motion`.

# v0.3.21 — Rounded transparent glass surfaces

- Disabled the system Acrylic backdrop on the main app, notification stack and reminder alert. Acrylic was painting a rectangular grey backing into the transparent margins, which made the rounded glass cards look square-cornered.
- Explicitly request transparent, native-rounded frameless BrowserWindows (`roundedCorners: true`, `backgroundMaterial: 'none'`).
- Clip the main shell and its grain/highlight layers to a 30px radius; keep the HTML page transparent around it.
- Unified the notification stack and reminder card to a larger 24px glass radius, layered translucent charcoal gradients, a soft top-edge highlight and subtle grain. The space outside each card remains transparent.
- Kept the real robot renderer, wake popup sizing, reminder actions, IPC contracts and app services unchanged.
- Limitation: Electron documents that CSS blur on a transparent BrowserWindow cannot blur other desktop applications; native Acrylic does, but paints a rectangular backing. This release prioritizes correct rounded transparent corners and uses a frosted translucent CSS surface instead.

---

# v0.3.20 — Transparent glass groundwork

- Made the main Electron window transparent. Windows 11 Acrylic was initially enabled here, then removed in v0.3.21 because it left a rectangular backing outside rounded glass surfaces.
- Removed the opaque near-black page and faux desktop wallpaper layers. The full-window shell is now a smoked, translucent glass surface with blur, a fine grain layer and a soft top edge; its margin no longer exposes a black frame.
- Removed the fake black background from floating notification and reminder windows; translucent frosted cards are used instead.
- Preserved existing renderer behavior, IPC, card actions, wake services, and the live robot renderer.
- Fallback: systems without Windows 11 Acrylic support retain the translucent CSS glass, but external-desktop blur depends on Windows support.

# v0.3.19 — Responsive layout + Telemetry redesign

- **Telemetry panel redesigned** (CPU / Memory / Latency cards with live sparklines, Native Core state, 5-minute runtime chart with CPU % and Memory MB axes, Services list with live state, System Log). All values are real: `system:get-status` now returns whole-app CPU %, working-set memory (MB), and service state (Gemini key, Live voice, wake listener, sidecar). Latency = measured IPC round-trip. Other modules can write to the log with `statusPanel.addLog(level, message)`.
- **Navigation fix:** `flex-direction:row` added to `.nexora-nav-dock` in `glass-redesign.css`. `main.css` stacks the dock vertically, which pushed every tab except SETTINGS off the top of the window.
- **Responsive:** on tablet/phone widths (<= 980px) the nav row now sits above the panel instead of overlapping its title; Orb Studio stacks the live preview above the controls (<= 899px) instead of overlapping them; Telemetry reflows 4 -> 2 columns and stacks services/log.

---

# Fix notes (reference: Nexora_until_done)

**Gemini model**
- Default chat model is now `gemini-2.5-flash`; ladder is the measured-healthy one from the reference: 2.5-flash, 2.5-flash-lite, 3.5-flash, 3.5-flash-lite, 3.1-flash-lite, then `-latest` aliases. Invented `3.8/3.7/3.6-flash` rungs removed. Max 4 rungs per message.
- Live: `gemini-3.8-live`, then `gemini-2.5-flash-native-audio-preview-12-2025`.
- Discovery no longer puts TTS / image / embedding / audio models into the chat ladder.
- Config migration no longer rewrites `gemini-2.5-flash`; native-audio Live model names are accepted.

**Wake up**
- Wake clip request: `maxOutputTokens` 4 + default thinking returned empty text on 2.5 Flash, so "Hey Nexora" never fired. Now 64 tokens and thinking off for 2.5 Flash.
- Wake detector is reset after mute/stop so old audio cannot re-trigger.
- Mute words aligned with the reference (okey, okk, paniten, pannungal).

**Live / popup**
- Normal Gemini socket recycle (close 1000/1011/1006) reconnects to the SAME model with the session-resumption handle (up to 5 tries, backoff) instead of cooling the model down and switching.
- Error popup now auto-hides after 4 s (it used to stay on screen forever when wake standby was off).

## Round 2
**Slow replies**
- Model discovery (up to 12 s on first use) no longer blocks chat/wake/Live; pinned ladder is used immediately and discovery refreshes in the background (also pre-warmed when wake standby turns on).
- Wake clip ends after 220 ms of silence (was 280), tries `gemini-2.5-flash-lite` first, 5 s timeout (was 10 s). Popup window is pre-created hidden.
- Live end-of-speech: HIGH sensitivity, 380 ms silence (was 700 ms). Mic buffer halved (2048 samples).
**Orb animation per state** (all 3 orb designs): idle = breathing ring, listening = cyan inward ripples reacting to mic level, thinking = violet spinning arcs, speaking = green voice bars reacting to output level, wake = white shockwave + flash, error = red jitter + flashing dashed ring, offline = dim grey. (State colours were previously ignored by the renderer — fixed.)
**Sound per state**: idle (soft low settle), listening (rising chime), thinking (3 ticks), speaking (bright 3-note shimmer), wake (sweep), error (2 buzzy beeps), offline (long descent).
**Mute**: saying "mute" now hides the Orb immediately (acts after ~250 ms) while wake standby keeps listening; the wake phrase shows it again.

## Round 3 (orb = nexora-orb-test.html)
- Removed my extra ring/bar overlays and state tints (they were clipped into a square in the window and looked wrong).
- Orb is now driven exactly like nexora-orb-test.html: same renderers, old-orb colours (cyan idle/speaking, green listening, violet thinking), 750 ms assembly when waking, same mic/out level scaling and attack/decay. Real mic/voice loudness is used when present, the test page's fake level otherwise. Error = red, offline = grey.
- The floating popup Orb no longer appears on top of the main window (that was the second orb in your screenshot). It shows only while the main window is hidden or minimized, and appears if you hide the window during a Live session.
- Test page copied to `orb-studio-reference/nexora-orb-test.html`.

## Round 4
- Background: richer dark space look (cyan glow behind the orb, violet/amber corner glows, dot grid, faint orbit rings, slowly drifting stars, vignette). CSS only, in `src/renderer/styles/main.css`; respects reduced-motion.
- Text box lifted: bottom offset 22 px -> 52 px.

## Round 5
- **Wake orb popup now shows.** It was suppressed whenever the main window was merely visible (even behind other apps), so it never appeared when you said the wake phrase. It is now suppressed only while the main window is focused/in front. Focusing the main window hides it; leaving the window during a Live session shows it again.
- **Popup orb default size = 132 px** (window 148 px, canvas 132 px). The orb engine's hard 160 px minimum canvas was removed (24 px minimum) so 132 renders exactly.

## Round 6
- Wake phrase now always pops the Orb up over the screen, like Siri (bottom centre, always on top), even when the main NEXORA window is open. Removed the "hide while main window is visible/focused" rules. Added a Siri-style slide/scale-in animation each time it appears. Orb size stays 132 px.

## Round 6 — Memory
- **Memory is now automatic.** Saying (typed or by voice) "remember that…", "my name is…", "call me…", "I live in…", "I work as…", "my favourite X is…", "I like/love/prefer…" or Tanglish "… ninaivula vechuko" saves it to the vault. "forget …" removes matching memories. Questions ("do you remember my name?") are never saved.
- **Live voice now has memory** (it had none before): the vault is added to the Live system prompt, and spoken statements are saved from the transcript.
- **Better recall:** everything about the user (name, preferences) is always sent; then notes matching the question; then the 4 newest. Search is Unicode-aware (Tamil works) with plural stemming. Before, memory was only used if a word >2 letters matched exactly, so "who am I?" found nothing.
- **No contradictions/duplicates:** name, city, job and "favourite X" replace the old value; identical notes are refreshed.
- **Safer saving:** vault is written atomically (temp file + rename).
- The assistant briefly confirms when it saves/forgets something. New files: `src/main/services/memory-learner.js`; tests added.

## Round 7 — Popup Orb size is now a setting
- The Orb art only fills 68% of its canvas, so the previous "132" canvas showed an Orb of only ~90 px. The popup canvas is now sized so the **visible Orb is exactly the chosen size** (default 132 px → 194 px canvas, 198 px window).
- New config `appearance.popupOrbSize` (default 132). On the Orb page, the size buttons (Big 220 / Default 132 / Small 84 / Cursor 30) now set the main preview AND the popup Orb size; the popup flashes for ~2 s so you can see the new size, and the choice is remembered after restart.

## Round 8 — Popup Orb Studio
- **Popup Orb no longer draws over the main window.** It appears on the wake phrase only while the main window is closed (tray), hidden or minimized; opening the main window hides it.
- **New "Popup Orb Studio" section in Orb Studio** (below the state buttons): preset (same as main / NEXORA old / Neural Sphere / Particle Flow), size buttons 220/132/84/60 + custom slider 40–300 (default 132 = visible Orb diameter), position (6 corners/edges + centre), state preview chips, Preview / Hide preview / Reset.
- The main Orb preview size buttons are separate again and no longer change the popup.
- Settings are saved (`appearance.popupOrbSize|popupOrbPosition|popupOrbProfile`) and applied live; previews show the popup for 4 s even while the main window is open.

## Round 9 — Wake word now uses Gemini speech-to-text properly
**Why it failed**
- Gemini was asked to "reply exactly WAKE/NONE" — a fragile guess instead of real speech recognition.
- "Hey … Nexora" has a small pause; the old detector cut at 220 ms of silence, so it became two clips ("Hey", "Nexora"). While the first was being checked the second was **dropped**.
- Fixed mic threshold (0.03) missed quiet microphones.

**What changed**
- The clip is sent to Gemini as **speech-to-text** (`{"transcript": "..."}` JSON, temperature 0, thinking off). The wake decision is made locally by `matchWakePhrase()`: accepts Nexora / Nexo, STT misspellings ("next ora", "nexorra", "nexura"), Tamil/Hindi script spellings, "okay hey nexora what time is it"; rejects "extra", "next thing", "Alexa"…
- Detector: adaptive noise floor, 450 ms hang-over (one clip for the whole phrase), 350 ms pre-roll, up to 4 s clips, and a clip that arrives while another is being transcribed is **queued instead of dropped**.
- The Core status pill now shows what Gemini heard ("Heard “…” — say “Hey Nexora”") and the app console logs `[NEXORA Wake] <model> heard: "…" -> WAKE/ignored`, so you can see exactly what the STT returned.
- Tests added for pause-inside-phrase, queueing and 18 wake/no-wake phrases.

## Round 10 — Popup Orb always full size
- The popup Orb started its wake animation at 50% size and grew to 100%, so it looked small (≈75 px) for the first moments and after state changes. The popup now skips that assembly scale and is always drawn at the full chosen size (default 132 px). The main-window Orb keeps its 750 ms assembly animation.

## v0.3.7 — Reminder card + Gemini name/memory
**Reminder**
- The desktop reminder card (shown when NEXORA is behind other apps / hidden) now sits at the TOP-CENTRE of the screen, with exactly the same design as the in-app reminder card (red glow border, REMINDER label, amber Done, grey Snooze 10 min, × to dismiss).
- Done / Snooze / × work on the first click even while another app (VS Code, browser) has the focus (pointer-up + click handlers, first-mouse accepted).
- Pressing Done / Snooze ANYWHERE (desktop card, Reminder tab, voice, tray) now closes the in-app card too. Before, the in-app card stayed stuck on screen after the reminder was already Done. One reminder = one in-app card.
**Gemini name / memory**
- Live voice: every memory change (voice, chat, auto-extractor, Memory tab) is pushed into the running Live session, so "என்னோட பேர் என்ன?" is answered from the CURRENT memory instead of the memory the session started with ("name not having").
- A question word can never be saved as a name ("என்னோட பேர் என்ன" no longer risks saving "Enna").
- Chat/Live prompt: if the user asks their name and a Name line exists, answer with it; earlier "I do not know" replies in history are treated as outdated.

## v0.3.8 — Autonomy (features 1–6)
New folder `src/main/autonomy/` (hub, card-center, actions, policy, planner, agent, proactive, memory-upkeep, screen-help, watchers, action-log), new card window (`renderer/card.html`, `preload/card.js`), new **Auto** tab (`renderer/autonomy/autonomy-panel.js`), Live tools `run_task` / `explain_screen`, chat commands `/do …` and "explain my screen", stop word "Nexora, stop". See AUTONOMY_GUIDE.md. Tests: `tests/unit/autonomy-test.js`.

## v0.3.9 — Tasks are spoken (no more late / silent confirmations)
- Live voice: `run_task` now waits for the result (up to 7 s) and hands it to Gemini, so it says "Calculator open pannitten" right away. Before, the tool answered "started", Gemini had nothing to say, and spoke late or not at all.
- If the step needs your Allow tap first (slower than 7 s), Gemini says "approve on the card" now and announces "I opened …" the moment the task finishes.
- Live prompt: say a short "Seri, panren." BEFORE calling run_task; say the result in one short Tanglish sentence after; never stay silent.
- Tasks started from chat (`/do …`), the Auto tab or the download offer are confirmed out loud with the Gemini voice ("I opened Calculator."), or with the Live session if one is open. Long file paths are never read out (only the folder name).
- `explain_screen` returns the answer to Gemini to explain briefly (also stays on the card).

## v0.3.10 — Any app, any drive, answer cards by voice, per-monitor screen, Live that listens
**1. Planning was slow**
- Common goals no longer wait for Gemini at all: "open Discord", "open the anime folder in the D drive", "open D drive", "open YouTube", "play Kalyani song on YouTube", "google …" are planned instantly on your PC.
- When Gemini is needed, the planner uses the fast model first with thinking off, 2 models max and shorter time-outs (was 3 models × up to 8 s).
**2. Open any installed app (Discord, WhatsApp, Steam, Word, Telegram…)**
- New `src/main/autonomy/app-index.js`: reads your Start Menu shortcuts + Store apps (`Get-StartApps`), refreshed in the background. "Open Discord" finds it even with a spelling slip ("discrod"). Built-in apps (Chrome, VS Code…) work as before.
- The app name is only used to look up a Start Menu entry — never passed to a shell. Uninstallers and unsafe ids are skipped. The approval card shows the real app name.
**3. Folders on any drive**
- "Open the anime folder in the D drive" finds the folder by NAME on D: (shallowest exact match, depth 3, skips Windows / Recycle Bin / Program Files) and opens it. "Open D drive" opens the drive. A missing drive says so ("I can't see a Z: drive").
**4. Approve cards by voice — no mouse**
- While a permission card (or task-plan card) is open, say **"OK"**, "allow", "seri", "yes", "go ahead" → Allow (for this session when the card says so); **"always allow"** → Always (only if the card offers it); **"no"**, "deny", "venam" → Deny. Works during Live talk AND in wake standby (no "Hey Nexora" needed).
- Safety: matched in code against a short word list — a long sentence that merely contains "ok" never approves anything. Switch: Auto tab → "Approve by voice" (on by default). Cards now show "Say “OK” to allow".
**5. Several monitors**
- "Explain my screen" / "see the entire screen" now looks at EVERY monitor (main first, each labelled). "See my Chrome screen" / "see the Brave screen" looks at the monitor that app's window is on (also VS Code, Discord, any app). "This screen" = the monitor under the mouse. If the app has no open window NEXORA says so.
- Approval / task cards now appear on the monitor you are using (under the mouse), not always the main one.
**6. Live talk "wake works but it does not listen"**
- Cause: after "Hey Nexora" the wake clip was sent to Gemini for transcription (1–3 s) and the Live session connected after that; everything you said in that time (and the command in the same breath, "Hey Nexora open Chrome") was thrown away, so Live woke up deaf.
- Fix: standby keeps the last ~8 s of microphone audio and hands everything spoken AFTER the wake clip to Live as soon as it connects; a command spoken with the wake phrase is sent to Live as text. The connect-time audio buffer grew from 18 chunks (<1 s) to ~10 s.
- Live voice detection: start-of-speech sensitivity LOW → HIGH (soft / quiet starts were ignored), 160 ms lead-in (was 40), 560 ms pause before NEXORA decides you finished (was 380, cut Tanglish sentences short).
- Tests: `tests/unit/apps-voice-screen-test.js` (run with `npm test`).

## v0.3.11 — Wake word on Gemini Live + "not listening" fixes (reference: JARVIS MARK 34)
- **Wake word now uses the Live model first.** Each speech clip is transcribed by a short throwaway Gemini Live session (`src/main/services/live-oneshot.js`), the approach JARVIS uses in `core/gemini.py`: Live has its own quota pool, so when the text-model quota runs out (the usual cause of NEXORA going deaf) wake still works. The text models (`gemini-2.5-flash-lite` ...) are now only the fallback. The wake decision is still made locally by `matchWakePhrase()`, strict phrases unchanged. Config: `voice.wakeEngine` = `"live"` (default) or `"text"`.
- A slow or flaky wake check no longer cools down the Live model the conversation uses; only quota / model-missing errors do.
- **Mic watchdog** (`voice-audio.js`): restarts capture by itself when the microphone is unplugged, the track ends, the AudioContext is suspended (sleep / lock) or no audio frames arrive for 4 s. The UI shows "Microphone recovered".
- **Quiet microphones:** speech-detect floor lowered 0.015 -> 0.010, and clips get JARVIS-style auto-gain (`boostPcm`) before transcription.
- **Auto-sleep:** like JARVIS `WAKE_SLEEP_TIMEOUT`, a Live session returns to wake standby after 120 s of silence (`voice.autoSleepSeconds`, 0 = never) instead of streaming the mic forever.
- Tests: `tests/unit/wake-live-test.js` (fake Live server) added to `npm test`.
- Not copied from the JARVIS reference: its `config/api_keys.json`, certs, voiceprints and memory files.

## v0.3.12 — slow replies, chat/Live separation, flash-lite 404 loop
- **Root cause of the repeated `gemini-2.5-flash-lite -> HTTP 404`:** memory extraction, the task planner, the agent, screen help and the wake text-fallback all hard-coded `gemini-2.5-flash-lite` first and never reported failures, so every spoken sentence retried the dead model (and the planner ran inside the Live `run_task` call, which the Live model waits for -> long silent replies). New `model-health.js`: any 404/429/5xx now puts the model on the shared cooldown list and all helpers skip it. Background text work now uses the **chat model first** (`gemini-2.5-flash`, your Settings choice); **Live uses only the Live model** (`gemini-3.8-live`, then its Live fallbacks). No Live model is ever used for chat and no text model for Live.
- **Live talk no longer goes into the chat.** Spoken words show as floating captions over the Orb; the typed chat history is untouched. (`voice.captionsInChat: true` restores the old behaviour.)
- **Latency:** Chromium background/occlusion throttling switches disabled; wake transcript no longer waits 900 ms (now 600 ms); every reply logs `[NEXORA Live] reply latency: N ms` in the terminal so a slow turn can be measured.
- Test `tests/unit/model-health-test.js` added to `npm test`.

## v0.3.13 — faster, more accurate wake word
- Wake check now uses Gemini speech-to-text (one HTTP call) FIRST. Gemini Live joins in parallel only if STT is slow (>1.6 s) or fails; first usable transcript wins. `voice.wakeEngine`: `auto` (default; old saved `live` = auto), `text`, `live-only`.
- New STT prompt: knows the name "Nexora/Nexo", Indian English/Tamil accents, forces sound-alikes ("next ora", "neksora") to be written as Nexora, never "next/nexus". Returns `wake` flag too; if flagged but misspelled, a sound-alike rescue accepts it.
- Matching: consonant-skeleton match (any spelling of nexora/nexo), more "hey" variants (hi, hai, hay), joined split words ("necks ora"). Still ignores "next round", "nexus", "hello nexora".
- Wake detector pre-roll 350→550 ms so the first syllable "Hey" is not cut off.
- Tests updated (`tests/unit/wake-live-test.js`), all passing.

## v0.3.13b — Live hearing fix
- Cause: the throwaway Live wake session auto-detected language and wrote Hindi ("हेनिक्सवर") / junk, while Gemini STT heard "Hey Nexora" correctly. Live now only joins after 3.5 s or if STT fails; its prompt says English/Tamil/Tanglish in Latin letters only.
- Wake matcher transliterates Devanagari/Tamil to Latin (so "नेक्सोरा", "हेनिक्सवर", "நெக்சோரா" still wake) and accepts fused "heynexora".
- Main Live conversation: told the user speaks only English/Tamil/Tanglish (no Hindi), to answer only clear speech aimed at it and never invent a question from noise/echo; end-of-speech now LOW sensitivity with 800 ms silence and 300 ms pre-padding so sentences are not cut mid-way.

## v0.3.13c — download card by voice, Notepad tasks, planner
- NEW DOWNLOAD card (Extract / Show folder / Ignore): NEXORA now SPEAKS it ("… zip download aayiduchu. Say extract, show folder, or ignore.") and you can answer by voice — "extract", "show folder", "ignore" (also ok/seri = Extract, no/venam = Ignore) — with or without "Hey Nexora", in wake standby or during a Live chat. Only short phrases count, so a long sentence never presses a button. It says "Extract pannitten." when done. Other watcher cards (Explain it / Ignore) answer to ok / no too.
- "Type 10 lines about Iron Man in Notepad" failed because no action could write text and Gemini timed out. New action `write_note` (permission: ask — say OK): saves a .txt on Desktop/Documents and opens it in Notepad.
- Planner: 3 models, 12 s each, a timed-out model is retried once, total 28 s (was 2 models x 5.5 s); thinking-off only sent to 2.5-flash models.
- Tests: tests/unit/download-voice-test.js.

## v0.3.14 — Robot Orb
- New Orb identity **NEXORA Robot** (3D robot) for the main Orb and the floating popup Orb; all 7 states drive body animation, face colour, status effects and lip sync from the real voice level. See `ROBOT_ORB.md`.
- New **Robot Studio** in the Orb panel: 22 expressions, 26+ facial actions, 6 special eye styles, 10 emote FX, 12 screen VFX, 14 body animations, 6 paints, view framing.
- Profile whitelists (config, voice service, popup window), orb sound identity and CSP (`blob:` images) updated. New test `tests/unit/robot-test.js`.
- v0.3.14b: default robot colour is now the graphite/black Animation Lab look (`Nexora Black`); glass orb bubble removed; popup robot loads eagerly in the hidden popup window, falls back safely, and is scaled to the popup size.

- v0.3.14c/d: the popup Robot is sized from the usable area of the monitor under the mouse (28 % of its height, 200–400 px, the size slider is a relative scale) and re-fits when a monitor is added, removed or rescaled; round orbs scale 0.75–1.3x against a 1080p work area.

## v0.3.16 — Robot build + all fixes (14d + v0.3.15 work)
**Cleanup:** duplicate `orb-studio-reference/web/` and `nexora-orb-test(2).html` removed (`web/` stays: root `index.html` + Rust server use it); old Swift prototypes -> `platforms/apple/legacy/`; notes/reports -> `docs/history/`, `AUTONOMY_GUIDE.md` and `ROBOT_ORB.md` -> `docs/`; versions fixed (`0.3.14d` was not valid semver; config default, test banner, README); dead config keys `popupOrbSizeMigratedV3/V4` removed.
**Autonomy:** Retry / Skip / Stop card when a step fails (max 2 retries; denied/stop/no answer still ends the task; `autonomy.agent.retryOnFail:false` turns it off); hourly caps per action (`autonomy.caps.<action>`, 0 = off); tests `autonomy-v014-test.js`.
**Wake word:** a cut-off Gemini JSON answer (`{ "transcript"`) is no longer treated as speech and the token limit is 256 (was 96); two clipped near-misses ("enexo", "anexo", "plexo") within 8 s count as one wake, a single one never does; tests `wake-v015-test.js`.
**Live diagnostics:** terminal lines `[NEXORA Live] connecting / connected / FAILED <reason> / connection closed <code> / audio is arriving / turn finished but … sent NO audio`. Live only speaks after YOU talk.

## v0.3.17 — pixel orb page removed
Removed the standalone browser page (root `index.html` + `web/`: dithered pixel orb "NEXORA :: CORE AI" with Rest/Talk/Listen/Think and glyph buttons, plus its agent scripts). The Electron app never loaded it (it uses `src/renderer/index.html`), so `npm start` is unchanged. The old root Rust prototype (`src/main.rs`, `Cargo.toml`, `run-minifb.bat`) is still in place, but its small web server no longer has a page to serve.


## v0.3.18 — Frosted Chrome Glass UI redesign
- Replaced the vertical navigation dock with the horizontal CORE / MEMORY / REMINDER / AUTO / CHAT / ORB / TELEMETRY / SETTINGS text menu, preserving existing navigation keys and badge logic.
- Added a local-only Frosted Chrome Glass visual layer: near-black palette, translucent charcoal panels, film-grain texture, top-edge highlights, monochrome controls, responsive workspace surfaces and reduced-motion handling.
- Restyled Home, Chat, Memory, Reminders, Auto, Orb Studio, Telemetry, Settings, notification cards, reminder alerts and the floating wake popup caption.
- Kept existing page data sources, reminder actions, robot renderer/FBX pipeline, settings persistence, service logic, preload API and main-process IPC contracts unchanged.
- Poppins and JetBrains Mono are preferred when available; no external fonts or npm dependencies were added. The app uses the configured Segoe UI / Nirmala UI fallbacks when those fonts are not installed.
- Validation: see the v0.3.18 delivery notes for the test and syntax-check results; Electron visual rendering and multi-monitor behavior require manual Windows verification.

# v0.3.22 — Readable frosted glass + integrated-GPU performance

- Increased the main glass surface opacity so editor/window content behind NEXORA no longer competes with UI text.
- Kept one moderate 14px backdrop blur on the main glass shell; removed nested backdrop-filter passes from controls and cards.
- Removed active full-window SVG turbulence noise filters and replaced them with lightweight static glass highlights.
- Made small reminder/notification cards more opaque for legibility where cross-application backdrop blur is unavailable.
- Capped the Orb/WebGL loop at 30 FPS, reduced framebuffer size and DPR, disabled MSAA, selected low-power WebGL, and reduced face texture/anisotropy.
- Stopped rendering the 3D robot while pages without a robot canvas are active, and paused it when the app document is hidden. Voice services remain active in the main renderer.
- Removed the separate permanent telemetry RAF loop; frame telemetry is now sampled from actual visible OrbEngine renders.
- Slowed telemetry IPC polling to 2 seconds and made the hidden popup audio-level decay timer pause while hidden.
- Kept existing application features, IPC contracts, and dependencies unchanged.


# v0.3.23 — Settings panels, composer and render profiles

- Rebuilt the Settings navigation so it switches between independent section cards instead of scrolling one long combined settings sheet. Each selected section is contained within the content area and hides its scrollbar while preserving access to longer controls.
- Added a Performance optimization section with Low, Medium, High and Very High profiles. The selected profile is saved as `performance.mode` and updates the OrbEngine frame cap, canvas device-pixel ratio and RobotOrb framebuffer size immediately.
- Kept Medium as the default profile for balanced integrated-GPU usage. The profiles change render quality only; microphone, wake-word, Live voice, Gemini, reminder and automation services remain enabled as before.
- Removed the inner rectangular border from the Home quick composer textarea so the text field sits cleanly inside the rounded pill.
- Changed Settings and page close affordances from chevrons to X icons, moved titlebar buttons above overlapping navigation hit areas, and hardened the minimize IPC action.
- Validation: all existing unit suites, performance-profile regression checks, renderer syntax checks and zip integrity checks. Native Windows click behavior still requires manual desktop verification.

## v0.3.35 — Telemetry: smooth real-time rendering
- Chart and sparklines moved from SVG + `innerHTML` rebuilds (once per 2 s poll) to canvas drawn by one rAF loop.
- Sampling every 1 s (5 s while the page is closed so the 5-minute history is already filled on open); drawing is independent.
- Time scrolls continuously; line heads are interpolated between real samples (no extrapolation, no simulated data).
- Monotone cubic curves, eased axis ranges (CPU axis now auto-scales so low CPU is readable), eased big numbers.
- Hover crosshair + read-out (time, CPU, memory, latency).
- Keyed service rows (only changed text nodes touched); loop pauses when hidden/off-screen; falls back to 30 fps if drawing gets expensive.

## v0.3.35 — Owner info moved
- Removed the global "NEXORA owner" pill from the top of Settings.
- Settings > General now shows "Nexora Owner: Codewithsempai".
- Settings > About > Product Information now lists Owner_name: Dayanithi and Code_name: codewithsempai.
- Settings now always opens on ABOUT. General shows "Nexora Owner" at the top, styled like About > Product Information.
- Meta-line labels uppercase; Code_name value shown as Codewithsempai.
- `cargo run -- --desktop` now launches the full Electron desktop app (auto-installs Electron on first run). The old native orb window moved to `--minifb`. run.bat uses cargo.
- Added LICENSE, PRIVACY.md, SECURITY.md, CONTRIBUTING.md; README links them and now describes the offline wake word.
