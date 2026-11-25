# NEXORA v0.3.8 — Autonomy

Open the new **Auto** tab (⚡ in the dock). Everything below can be switched on/off there, and every action is listed in the **Action log**.
All popups (approvals, brief, nudges, watcher offers, task progress) appear as cards at the **top-right** of the screen; reminder cards stay top-centre.

| # | Feature | How it works | Default |
|---|---------|--------------|---------|
| 1 | Morning brief | One card per day: reminders today, latest project, yesterday's summary | on |
| 1 | Reminder nudges | After 2 snoozes (or you say "later" / "apram") NEXORA offers In 1 hour / Tomorrow 9 AM / Done | on |
| 1 | Habit check-ins | Water / stretch every N minutes (quiet hours 22:00–07:00 respected) | off |
| 2 | Memory upkeep | Merges duplicates, retires chat notes older than 45 days, writes "Daily summary" from the action log + reminders + saved memories (never raw chat), keeps 14 summaries | on |
| 2 | Confirm old facts | Location / work / college older than 90 days → "Is this still true?" (Yes / Change / No remove). One question a day. | on |
| 3 | Computer actions | Fixed catalogue only: open app / folder / link / VS Code folder, search files, clipboard read/write, create folder, extract zip. No free-form commands. | approvals |
| 3 | Permission levels | Per action: Ask every time · Ask once per session · Always allow · Never allow | see tab |
| 4 | Explain my screen | Hotkey **Ctrl+Shift+E**, voice "explain my screen", or the Auto tab. One screenshot → Gemini, never saved | on |
| 4 | Window-title watcher | Reads only the active window title: offers help for error windows or 20+ min on one window | off |
| 5 | Tasks | `/do create a folder nexora-test on the desktop and open it in VS Code`, or say it to Live. NEXORA shows the plan, you press Run, each step still follows its permission. Max 8 steps / 3 min. **Stop**: card button, Auto tab, or say "Nexora, stop". | on |
| 6 | Watchers | New .zip in Downloads → Extract?; battery ≤20 % / ≤10 %; disk < 10 GB or < 8 %; copied error text → Explain? (off by default) | zip/battery/disk on |

## Safety rules built in
* Medium-risk actions (clipboard, create folder, extract zip) default to **ask every time** and never offer a one-click "Always".
* Nothing is approved by silence: no answer in 60 s = cancelled.
* A denied or failed step ends the task. Folders/zips are restricted to Downloads, Documents, Desktop (VS Code: inside your user folder). `javascript:`/`file:` links are refused. Characters that could break out of cmd.exe are refused.
* Memory is never removed without your button press.

## Needs a real-PC check
Windows-only parts (open apps through `cmd /c start`, `tar` extraction, PowerShell probes for battery and window title, screen capture, the global hotkey) are written and unit-tested with fakes, but could only be run on a real Windows PC.

## v0.3.10 additions
- **Any app:** "open Discord / WhatsApp / Steam / Word" — NEXORA finds it in your Start Menu (shown in the Auto tab app list).
- **Any drive:** "open the anime folder in the D drive", "open D drive".
- **By voice:** when a card asks permission say "OK" / "seri" (allow), "always allow", or "no" / "venam" (deny). Auto tab → "Approve by voice" switches it off.
- **Monitors:** "explain my screen" = all monitors · "see my Chrome screen" / "see the Brave screen" = the monitor that app is on · "this screen" = the monitor under the mouse.

## v0.3.14+ additions
- **Failed step?** A card offers **Retry / Skip step / Stop** (up to 2 retries per step). Denying a step, pressing Stop or not answering ends the task.
- **Hourly caps** limit how often one action can run (clipboard read 10/hour, open app 30/hour, write_note 10/hour...). Change under config `autonomy.caps.<action>`; `0` removes the cap.
- Text from your screen, clipboard or watchers is only ever *explained* — it can never start a task.
- Screen hotkey already used by another app? Change `autonomy.screenHotkey` (default `CommandOrControl+Shift+E`).
