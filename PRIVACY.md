# NEXORA Privacy Policy

*Last updated: 25 November 2026 - applies to NEXORA v0.3.x*

NEXORA is a desktop AI assistant. **It has no NEXORA account, no NEXORA servers,
no analytics and no crash-reporting service.** The app talks directly from your
PC to **Google's Gemini API using your own API key**. The developer cannot see
your conversations, audio, screenshots or memories.

This page tells you exactly what stays on your PC and what is sent to Google.

## 1. What is sent to Google (Gemini API)

Data is sent **only when you use the matching feature**, over encrypted
connections to `generativelanguage.googleapis.com`, authenticated with your key.

| Feature | What is sent | When |
|---|---|---|
| **Chat** | Your message, recent chat history and the memories that are relevant to the question | Each time you send a message |
| **Live voice** | **Microphone audio** (16 kHz PCM) streamed live, plus the audio and transcript coming back | Only while a Live voice session is active (after a wake word, a mic button press or a hotkey). The orb popup shows when it is active. |
| **Explain my screen** | **A screenshot** of all monitors, or of the one you chose ("this screen", "my Chrome screen") | Only when you press the hotkey (Ctrl+Shift+E), say "explain my screen", or press Explain on a card. Never automatically. |
| **Explain copied error text** | The text from your clipboard | Only when you press Explain on a card (the clipboard watcher is off by default) |
| **Memory and reminder understanding** | The sentence you typed or said (for example "my college is...") so Gemini can turn it into a structured memory or reminder | When your message looks like a memory/reminder request |
| **Spoken replies (TTS)** | The text to be spoken | When NEXORA speaks with a Gemini voice |
| **Model list** | Your API key only (to list the models your key can use) | When Settings or a fallback needs the model list |
| **Task planning** (`/do ...` or voice) | Your task sentence | When you ask NEXORA to plan a task |

Screenshots are held in memory for the request and are **never written to disk
by NEXORA**.

### Update check (GitHub, not Google)

Installed builds check **GitHub Releases** for a newer version of NEXORA: one
anonymous `GET` request to `api.github.com` (the release list of the NEXORA
repository) shortly after start-up and then about once a day. No API key,
account, memories, audio or identifiers are sent; GitHub sees your IP address
and a `NEXORA/<version>` user-agent, as with any web request. If a newer version
exists, NEXORA only **shows a notice**. It never downloads or installs anything
by itself; you open the release page and install it manually.

You can switch this off in **Settings -> Support & Updates**. Development builds
(`npm start`) never check on their own.

### What Google does with it
Google receives this data as the provider of the Gemini API and handles it under
**its own terms and privacy policy**, which can differ between free and paid
API plans (including whether content may be retained or used to improve
Google's products). Please read them for your plan:
- Gemini API terms: https://ai.google.dev/gemini-api/terms
- Google Privacy Policy: https://policies.google.com/privacy

**Do not show or say anything through NEXORA that you do not want Google to
receive.** In particular, close windows with passwords, banking or private
messages before using Explain my screen.

## 2. What never leaves your PC

- **Wake-word detection** ("Hey Nexora", "Nexora", "Hey Nexo", "Nexo") runs
  **offline** with local ONNX models. While NEXORA waits for its name, **no audio
  is sent anywhere**. Audio only starts streaming to Google after a wake or when
  you start Live voice yourself.
- **Window-title watcher** (off by default): reads only the active window title
  locally, no screenshots. Nothing is sent unless you press *Explain*.
- Battery, disk and Downloads watchers, the action log, reminders, expression
  logic for the robot face and the Telemetry page all run locally.
- NEXORA does **not** use the camera.

## 3. What is stored on your PC

Stored in your user-data folder (Windows: `%APPDATA%\nexora`) unless noted:

| Data | File / place | Protection |
|---|---|---|
| Gemini API key | `gemini-key.enc` | Encrypted with the operating system's secure storage (Electron safeStorage) |
| Memory Vault (preferences, personal facts, projects, notes) | `memory-vault.enc` (+ `.bak`) | Encrypted with AES-256-GCM. **The key is kept in a file next to the vault** (`memory-vault.enc.key`), so this protects against casual reading or accidental sharing, **not** against someone who can use your Windows account or copy the whole folder. |
| Settings | `nexora-config.json` | Plain JSON |
| Reminders | `reminders.json` | Plain JSON |
| Action log (last ~300 actions NEXORA did) | `action-log.json` | Plain JSON |
| Chat history (last 100 messages) | Browser storage inside the app (`localStorage`) | Not encrypted |

NEXORA stores no audio recordings or screenshots.

## 4. Your controls

- **Delete memories:** Memory tab (or say "forget ..."). Memory is never removed
  without your action; automatic upkeep only merges duplicates and retires old
  chat notes.
- **Clear chat:** Conversation panel -> clear history.
- **Stop sending data:** turn off the mic / Live, switch off Explain my screen in
  the **Auto** tab, or remove the Gemini key in Settings -> Gemini.
- **Wake standby is opt-in** and can be switched off in Settings.
- **Update check:** switch it off in Settings -> Support & Updates.
- **Delete everything:** quit NEXORA and delete the `nexora` folder in
  `%APPDATA%`, then revoke your API key in Google AI Studio if you want.
- **Permissions:** every computer action (open app, clipboard, create folder,
  extract zip...) follows a permission level you set in the Auto tab. Text from
  your screen or clipboard is only ever *explained*; it can never start an action.

## 5. Children

NEXORA is not directed at children under 13 (or the minimum age in your country).
Gemini API use is subject to Google's age requirements.

## 6. Changes

If NEXORA starts collecting or sending data in a new way, this file is updated
in the same release and the change is listed in the release notes.

## 7. Contact

Privacy questions or requests: open a GitHub issue (no personal data please) or
email `<your-contact-email>`.
