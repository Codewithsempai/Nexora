# NEXORA — Apple Platform Architecture Roadmap

This directory contains starter interfaces and architecture definitions for future macOS and Apple ecosystem deployment (Phase 2+).

## Target Components
- `NexoraCompanion.swift`: Transparent, borderless floating HUD overlay leveraging macOS `NSPanel` and `NSStatusBar`.
- `NexoraBridgeProtocol.swift`: Bidirectional WebKit communication protocol tying native Darwin events to the Quantum Orb State and Synthesizer.

## Isolation Policy
- Swift modules are intentionally isolated and are not compiled on Windows 11.
- The core Windows 11 desktop application relies on Electron + native Rust sidecar architecture.
