# NEXORA v0.3.2 — Bigger popup Orb, Memory tab, Reminder tab

## 1. Popup Orb is bigger
* Default visible size **132 px -> 280 px** (slider now goes up to **500 px**; presets: Huge 400, Default 280, Medium 200, Small 132, Tiny 84).
* One-time upgrade: if your saved popup size was smaller than 280 it is raised to 280 on first start. After that your own choice is respected.
* The window is automatically limited to the usable screen height, so a huge size can never go below the taskbar.
* Change it any time: **Orb tab -> POPUP ORB STUDIO -> Size**.

## 2. New navigation: Core · Memory · Reminder · Chat · Orb · Telemetry · Settings

### Memory tab (live)
* **LIVE ACTIVITY** feed: the moment NEXORA saves, edits, refreshes or forgets something (typed chat, spoken Live talk, or the panel) it appears here with its source (Chat / Voice / You) and the new row glows green.
* Counters per category (Preferences, Knowledge, Projects, Conversations) that double as filters.
* Add, search, **edit**, delete, clear all (asks twice), and **export to JSON**.
* If you are on another tab, a small "Memory saved from voice/chat" toast appears; click it to open the Memory tab.
* Still encrypted at rest (same vault as before).
* Try: say "my name is Daya", "remember that I like filter coffee", "forget filter coffee".

### Reminder tab
* **Quick add** in plain words: `call mom in 10 minutes`, `submit report tomorrow at 9am`, `gym every day at 6am`.
* Or pick date + time + repeat (once / daily / weekdays / weekly / monthly) with quick chips (+10 min, +30 min, +1 hour, Tomorrow 9 AM).
* Voice and chat work too: "Hey Nexora, remind me to drink water in 20 minutes", "remind me at 5pm to send the report", "wake me up at 6am", Tanglish like "10 nimidam kalichi remind pannu".
  If you give no time, NEXORA asks for it; a time that already passed is refused.
* When a reminder is due: a sticky alert (Done / Snooze 10 min), a sound, the Orb wakes, a Windows/macOS notification, and the floating Orb pops up if the main window is hidden in the tray.
* Reminders are checked every second in the main process, saved in `reminders.json` (user-data folder), and survive restarts. One that came due while NEXORA was closed fires once on the next start as "Missed reminder".
* The Reminder tab icon shows a red count of reminders waiting for an answer.
* Settings: `reminders.nativeNotifications` and `reminders.popupOrb` in `nexora-config.json` (both on by default).

## 3. Files
New: `src/main/services/{reminder-parser,reminder-service,assistant-commands}.js`, `src/renderer/memory/memory-panel.js`, `src/renderer/reminders/reminder-panel.js`, `src/renderer/components/toast.js`.
Changed: `memory-store.js` (change events, edit, stats, source), `memory-learner.js`, `voice-service.js`, `ipc-handlers.js`, `app.js` (main + renderer), `popup-window.js`, `config.js`, preload, navigation, index.html, main.css, tests.

## 4. Run
```
npm start
npm test        # 13 suites: parser, scheduler, live memory events, config migration ...
```
Restart NEXORA fully (right-click tray icon -> Quit, then `npm start`) so the new preload loads.

---
# v0.3.3 — Popup Orb bigger again
* Default visible popup Orb **280 -> 380 px**; slider max **500 -> 700 px**. Presets: Huge 520, Default 380, Medium 280, Small 200, Tiny 132.
* One-time upgrade (`popupOrbSizeMigratedV3`): saved sizes below 380 are raised to 380 on first start; later choices are kept.
* Window is still limited to the usable screen height.
* Tabs: Core · Memory · Reminder · Chat · Orb · Telemetry · Settings. Memory tab shows live saves; Reminder tab supports quick add, voice and chat.

## v0.3.3 — Memory + reminders fixed to save and persist
**Why "my name" was not saved**
* The vault refused to read or write whenever OS secure storage was unavailable or the old vault file could not be decrypted, and it failed silently. Now it always works: OS-secure storage when available, otherwise an AES-256-GCM app key file (`memory-vault.enc.key`) beside the vault. An unreadable old vault is renamed `memory-vault.enc.unreadable-<time>` and a fresh one starts, so saving is never blocked.
* Typed chat ran "save / remind" only AFTER the API-key check and model lookup. Now it runs first, so memory and reminders work with no key, offline or when Gemini errors. If Gemini cannot answer, you still get a local confirmation ("Saved to memory: …", "Reminder set: …").
* More name forms: "I am / I'm Daya", "this is Daya", "en peru Daya" (plus my name is / call me). Moods like "I am tired" are not saved as names.

**Close and reopen**
* Memory: `memory-vault.enc` and reminders: `reminders.json` live in the NEXORA user-data folder, written atomically. Restart tests added (new instances read the same data). The Memory tab footer shows the count and storage mode.

---
# v0.3.4
**Popup Orb:** back to a sensible size. Default visible Orb **200 px**, position **Screen center** (reference default is 132, pin center). Presets Big 300 / Default 200 / Small 132 / Tiny 84, slider max 500. One-time reset (`popupOrbSizeMigratedV4`) replaces the too-big 380 saved by v0.3.3.

**Memory understands any language (like the reference `remember` tool):** `src/main/services/memory-extractor.js`. Instant regex first; if nothing matched, a small JSON-only Gemini call (flash-lite, 4.5 s limit) reads Tamil script, Tanglish, Hindi or any wording and returns facts / forget / reminder. Used for typed chat AND spoken Live transcripts; saves are pushed to the Memory tab live. Passwords/OTP/card numbers are never stored. Needs your Gemini key (already needed for chat).
* Examples: "என்னோட பெயர் டயா", "my father's name is Ravi", "my college is SRM University", "I am 21 years old", "my birthday is 5 May 2004".

**Personal info:** new **Personal** category and a PERSONAL INFO card at the top of the Memory tab (Name, Age, Birthday, City, College, School, Father, Mother, Brother, Sister, Work + any other). A new value for the same field replaces the old one. Personal info is always sent to the assistant as context.

---
# v0.3.5
* **Clearing memory really forgets:** old chat messages are no longer sent to Gemini after you clear/forget memory (chat panel cut-off), the Live session gets a "forget" note and its resume handle is dropped, and the system rules say memory is the only source of personal facts.
* **Tamil stays Tamil:** a Tamil message is saved in Tamil script ("பயனரின் பெயர் டயா"), names are never transliterated or translated to English. Each personal field also stores the raw `value` shown in the PERSONAL INFO card.
* **Popup Orb:** 200 px, **bottom centre** (one-time reset `popupOrbSizeMigratedV5`).
* **Owner:** codewithsempai_daya added to package.json author, README, Settings, source headers and the assistant's system prompt.
* **`codewithsempai_daya_memory_reminder_module/`:** the memory + reminder code copied into one folder for reuse in your other projects.
* From the new reference (tests.zip): Tamil mute word added; reminders already have Delete + Clear finished.

---
# v0.3.6 — Memory no longer forgets after restart
* Cause: the vault switched between OS-secure and app-key encryption between runs; the old file then failed to decrypt and was renamed away, starting an empty memory. Any short file lock also counted as "corrupt".
* Now: one stable key for writing (old OS-secure vaults are still read and migrated), fsync'd atomic writes on every change, a `memory-vault.enc.bak` backup of the last good vault with automatic recovery, unreadable files are copied (never deleted), and temporary read errors never wipe anything.
* Data folder pinned to `%APPDATA%/nexora` so it is the same however NEXORA is launched. reminders.json also fsyncs.
* New test: encryption mode flipping + recovery from corrupt file.

---
# v0.3.6b — strict wake word, English memory, Tanglish replies
* **Wake word:** only `Hey Nexora`, `Hey Nexo`, `Nexora`, `Nexo` wake NEXORA. "Hey Nexora <command>" also works. "Hello Nexora", "Nextora, play the track", "next round" etc. are ignored (`matchWakePhrase` in voice-utils.js; list of accepted spellings is in `WAKE_LONG_ALIASES` / `WAKE_SHORT_ALIASES`, greeting words in `WAKE_HEY`).
* **Memory is saved in English letters**, even when you speak Tamil (தயா -> "The user's name is Daya"). Old Tamil-script entries are converted when the vault loads.
* **NEXORA replies in Tanglish** (typed chat and Live voice).

---
# v0.3.6c — Gemini handles memory (chat + Live), age saves properly
* **Gemini Live now has memory tools** (`save_memory`, `forget_memory`, `set_reminder`). While you talk, Gemini itself decides what to remember (name, age, college, family, likes…) in any language, saves it in English letters, then confirms in Tanglish. A save only counts when the tool returns "saved". The old transcript-based save stays as a backup.
* **Typed chat:** Gemini understanding now uses the same working model list as chat (it used a fixed model name that may not exist for your key, so "என்னோட ஏஜ் 20" was silently skipped). Time limit raised to 10 s. Failures are printed in the terminal as `[NEXORA Memory] …`.
* **Age works offline too:** "my age 20", "ennoda age 20", "en vayasu 20", "naan 20 vayasu", "என்னோட ஏஜ் 20" -> "The user is 20 years old".
* **Forget by topic:** "forget my age / name / college / father" removes that saved fact.

---
# v0.3.6d — Spoken reminders, higher popup Orb
* **Reminders are spoken**: when one is due NEXORA says it aloud, e.g. "Daya, Reminder! Study. Seekiram pannunga." (uses your saved name). If you do not press Done / Snooze it repeats up to 2 more times, 1 minute apart. Works for any text (study, homework, work…). Uses the Windows English (India) voice if installed.
* (Popup lift from this step was replaced in v0.3.6e below.)
* Windows notification title now shows "NEXORA" instead of "com.nexora.desktop".

---
# v0.3.6e — Popup Orb sits right above the taskbar
* The popup window is bigger than the visible Orb (transparent padding), so it looked like it floated in the middle. Bottom positions are now placed by the VISIBLE Orb: it rests about 6 px above the taskbar (`gap` in `popup-window.js`). Increase `gap` to raise it a little.
* Applies to bottom-left / bottom-center / bottom-right and every Orb size.

---
# v0.3.6f — Reminders use the Gemini voice
* Spoken reminders are now generated by Gemini text-to-speech with the same voice you picked for Live (`ai.voiceName`, default Charon), not the Windows voice. New `src/main/services/tts-service.js`; IPC `reminder:speak`.
* TTS models are discovered from your API key (flash TTS first) and failures are remembered for 5 min. The same sentence is cached, so the 1-minute repeats do not call the API again.
* The local Windows voice is used ONLY if Gemini voice is unavailable (no key, offline, quota). Failures print `[NEXORA Voice] Gemini TTS …` in the terminal.

---
# v0.3.6g — Desktop reminder card + proper memory folders
**Reminder shows outside the app**
* When a reminder is due and NEXORA is hidden, minimized or behind another app (VS Code, browser…), a small always-on-top card appears bottom-right above the taskbar: the reminder text, **Done**, **Snooze 10 min**, **Open NEXORA**. It stays until answered, shows "+N more" when several are due, and disappears by itself when you answer anywhere or open NEXORA. The Windows toast, sound, popup Orb and Gemini voice still happen too.
* New: `src/main/application/reminder-alert.js`, `src/preload/alert.js`, `src/renderer/reminder-alert.{html,js}`, `styles/reminder-alert.css`.

**Memory folders handled by Gemini**
* Gemini (typed chat, and Gemini Live tools) now sorts every fact into the right folder: **personal** (identity), **preferences** (likes, habits, how you want NEXORA to behave), **knowledge** (other facts / "remember that…"), **projects** (what you are building / studying for / working on) and **conversations** (rare: a notable decision from a chat). Before, projects and conversations were never filled and everything fell into knowledge.
* A message with several facts ("I am Daya and I'm building NEXORA, I prefer short answers") is saved by the quick rules AND by Gemini, so nothing is lost; duplicates are merged. Up to 6 facts per message.
* Offline rules also understand "my project is X" and "I am building / working on X".
* Projects are always included in the context given to Gemini.

---
# v0.3.6h — Desktop reminder card looks like the in-app toast
* Compact card (392×140) bottom-right above the taskbar: ⏰ REMINDER, the text, **Done** and **Snooze 10 min**, and a **✕** to close it. "Open NEXORA" and the time line were removed.
* Buttons are clickable straight from the desktop (window is focusable; it still appears without stealing focus).
* ✕ hides the card without answering; the reminder stays waiting in the Reminder tab and the card does not pop up again for the same alert.
