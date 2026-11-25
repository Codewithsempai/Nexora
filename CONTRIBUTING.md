# Contributing to NEXORA

Please read [LICENSE](LICENSE) first: NEXORA is free software under the
GNU Affero General Public License v3.0 (AGPL-3.0-or-later). By contributing you
agree that your contribution is released under the same license, and you also
grant the project owner the extra permission described below.

By taking part you also agree to be respectful: no harassment, no personal
attacks, and keep discussions about the project.

## Contribution terms

By submitting a contribution (pull request, patch or suggestion) you confirm
that you wrote it or have the right to submit it, and that it may be distributed
under the AGPL-3.0-or-later. You keep the copyright in your contribution. You
also grant the project owner a perpetual, worldwide, irrevocable, royalty-free
license to use, modify and distribute it as part of NEXORA under any license,
including a commercial one, so the owner can offer NEXORA under additional
license terms.

## Reporting a bug

Open a GitHub issue and include:

1. NEXORA version (Settings -> About) and Windows version.
2. What you did, what you expected, what happened (screenshots help).
3. The **Telemetry -> System log** lines around the problem.
4. Whether it is repeatable.

**Remove API keys, memories, screenshots with private content and personal data
before posting.** For security problems do **not** use issues; follow
[SECURITY.md](SECURITY.md).

## Suggesting a feature

Open an issue titled `Feature: ...` explaining the problem you want solved, not
only the solution. Features that send new data to Google or add computer
actions need a short note on privacy and permissions
(see [PRIVACY.md](PRIVACY.md) and `docs/AUTONOMY_GUIDE.md`).

## Sending a change

1. Open an issue first for anything bigger than a small fix.
2. Fork the repo and create a branch: `fix/short-name` or `feat/short-name`.
3. Set up and run:
   ```bash
   npm install
   cargo run -- --desktop        # launches the desktop app (installs Electron on first run)
   ```
4. Make the change. Keep it focused: one topic per pull request.
5. Run the tests and make sure they pass:
   ```bash
   npm test
   cargo test --manifest-path native/rust/Cargo.toml
   ```
6. Add or update tests in `tests/unit/` when you change behaviour.
7. Open a pull request describing **what** and **why**, with screenshots for UI
   changes.

### Code guidelines

- **Security first:** keep the renderer sandboxed. New IPC channels must be added
  to the whitelist in `src/preload/contracts/api.js` and validated in
  `src/main/ipc/ipc-handlers.js` (trusted-sender check, argument checks).
- **No secrets in code**, logs or screenshots. Never log API keys, audio or
  memory contents.
- **Computer actions** must come from the fixed catalogue with a permission
  level and cap; never run free-form shell commands.
- **Privacy:** do not add analytics, tracking or new network destinations. Any
  new data sent to Google must be user-triggered and documented in PRIVACY.md.
- **Performance:** the UI must stay smooth. Avoid per-frame DOM rebuilds
  (`innerHTML`), keep animation loops paused when a panel is hidden, and prefer
  canvas/CSS transforms for continuous motion.
- Match the existing style (2-space indent, single quotes, small focused modules).
- Do not rename or remove the owner/product information in Settings -> About.
- Update `docs/history/FIX_NOTES.md` with a short line for user-visible changes.

### Commit messages

Short, imperative, present tense: `Fix wake threshold clamp`, `Add reminder snooze test`.

## Questions

Open a GitHub issue labelled `question`.
