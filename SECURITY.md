# Security Policy

NEXORA runs on your computer with access to your microphone, screen capture,
clipboard, files you point it at, and a Google Gemini API key. Security reports
are taken seriously.

## Supported versions

Only the **latest release** (currently **v0.3.x**) receives security fixes.
Please update before reporting.

## How to report a vulnerability (privately)

**Do not open a public issue, discussion or pull request for a security problem.**

Use one of these:

1. **GitHub private reporting (preferred):** open
   `https://github.com/codewithsempai-daya/nexora/security/advisories/new` on the
   repository page (**Security -> Report a vulnerability**). Only the maintainer
   can see it.
2. **GitHub Issues (non-sensitive issues only):** `https://github.com/codewithsempai-daya/nexora/issues`.

Please include:
- what is affected (file, feature, version) and the impact;
- step-by-step reproduction (a short video or screenshot helps);
- your OS and NEXORA version (Settings -> About);
- whether the issue is already public.

**Never include real API keys, memory-vault contents or personal data in a
report.** If a key was exposed, revoke it in Google AI Studio first.

## What to expect

- Acknowledgement within **7 days**.
- A first assessment within **14 days**.
- Fixes are released as soon as practical; you will be told when it ships.
- Credit in the release notes if you want it (tell us how you want to be named).

Please give us reasonable time to fix the issue before disclosing it publicly.

## Scope

Examples of what we want to hear about:
- escaping the Electron sandbox, bypassing the preload/IPC allow-list or the
  Content Security Policy;
- running commands or opening files/URLs outside the fixed action catalogue or
  without the required permission;
- leaking the Gemini API key, memory vault, microphone audio or screenshots;
- a prompt-injection path where text from the screen, clipboard or chat starts
  a computer action without approval (screen/clipboard text must only be
  *explained*, never executed);
- path traversal in file actions (allowed folders: Downloads, Documents, Desktop).

Out of scope:
- problems that need an attacker who already controls your user account or
  has physical access to an unlocked PC;
- the memory vault key file sitting next to the vault (this is documented in
  PRIVACY.md);
- vulnerabilities in Electron, Chromium, Google services or other third-party
  software themselves (report those upstream; tell us if NEXORA is affected);
- spam, social-engineering or denial-of-service against third-party services.

## Built-in protections (for context)

- Sandboxed renderer, context isolation and a narrow, whitelisted preload bridge.
- IPC handlers only accept calls from NEXORA's own windows.
- Gemini API key is stored encrypted with the operating system's secure storage
  and never exposed to the renderer.
- Computer actions come from a fixed catalogue, have permission levels, hourly
  caps, an action log and a 60-second no-answer-means-cancel rule.

## Safe-harbour

We will not take legal action against people who research NEXORA in good faith,
avoid harming other users, do not access data that is not their own, and follow
this policy.
