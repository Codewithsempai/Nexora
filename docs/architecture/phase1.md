# NEXORA — Phase 1 Architecture & Technical Specification

> **Next-Generation Experience, eXecution, Orchestration, Reasoning & Artificial Intelligence**

## 1. Executive Summary

NEXORA Phase 1 establishes the production-grade foundation, spatial user interface, custom procedural orb engine, audio synthesizer rig, secure Electron desktop shell, and native Rust sidecar performance bridge.

This release focuses exclusively on **Phase 1: Foundation & UI**. Live generative AI models, autonomous desktop automation, persistent vector memory, and computer vision are intentionally architected for Phase 2+.

---

## 2. Technology Stack & Target Composition

| Technology | Target Ratio | Implementation Scope |
| :--- | :--- | :--- |
| **JavaScript** | **74.2%** | Electron main process, secure preload bridge, procedural Quantum Orb canvas engine, Web Audio acoustic synthesizer, spatial UI orchestration, and modular panels. |
| **Rust** | **14.2%** | Native performance core (`native/rust/`), high-efficiency 3D vector & harmonic math, system telemetry diagnostics, and stdio JSON-RPC 2.0 sidecar bridge. |
| **Swift** | **8.8%** | macOS future integration protocols (`platforms/apple/swift/`), floating HUD controller interface (`NSPanel`), and status bar integration (`NSStatusBar`). |
| **CSS** | **1.7%** | Design tokens (`tokens.css`), dark premium base (`#080A0E`, `#0D1118`, `#111721`), glassmorphic panels, and amber holographic styling. |
| **Other** | **1.1%** | Project manifests, HTML viewport harness, build scripts, and documentation. |

---

## 3. High-Level System Architecture

```
                    ┌───────────────────────────────────────────────┐
                    │               Windows 11 OS                   │
                    └───────────────────────┬───────────────────────┘
                                            │
                    ┌───────────────────────▼───────────────────────┐
                    │        Electron Main Process (Node.js)        │
                    │  - Single Instance Lock                      │
                    │  - Frameless Glass Window Manager             │
                    │  - Global Hotkey (Ctrl+Shift+Space)           │
                    │  - System Tray Controller                    │
                    │  - Local Config Store Persistence             │
                    │  - Security & Navigation Filters              │
                    └───────────────┬───────────────────────────────┘
                                    │
               ┌────────────────────┼─────────────────────┐
               │ (Typed IPC via Preload)                  │ (Stdio JSON-RPC 2.0)
               ▼                                          ▼
┌───────────────────────────────┐          ┌───────────────────────────────┐
│     Renderer UI Sandbox       │          │   Native Rust Core Sidecar    │
│  - contextIsolation: true     │          │  - High-performance 3D Math  │
│  - nodeIntegration: false     │          │  - Golden Spiral Generator   │
│  - sandbox: true              │          │  - Acoustic Voice Harmonics  │
│                               │          │  - Windows 11 Diagnostics    │
│  [UI Components]              │          └───────────────────────────────┘
│  - Quantum Orb Canvas Engine  │
│  - Centralized State Manager  │
│  - Web Audio Synthesizer      │
│  - Chat Conversation Shell    │
│  - Telemetry Status Panel     │
│  - Settings & Theme Panel     │
└───────────────────────────────┘
```

---

## 4. Quantum Orb Engine Specification

The central visual anchor of NEXORA is the procedural Quantum Orb. It uses a 620-point Golden Spiral spherical projection combined with dynamic harmonic surface waves, radiant atmospheric bloom, and orbital particle embers.

### State Machine (`OrbStateManager`)
All state transitions are strictly mediated through `OrbStateManager`:
1. `idle`: Slow ambient breathing, low-energy golden pulse (0.28 rad/s).
2. `listening`: Heightened harmonic responsiveness, active surface waves, acoustic reactivity.
3. `thinking`: Rapid energy flux rotation (1.85 rad/s), core compression, radiant golden embers.
4. `speaking`: Dynamic acoustic envelope expansion, rhythmic harmonic radiation.
5. `wake`: Transient power-up bloom, expanding from pinprick radiance to full dimensional sphere.
6. `offline`: Standby embers, damped steel-gray luminescence (0.08 rad/s).
7. `error`: Controlled amber-red warning flare with stabilization decay.

---

## 5. Security Architecture

- **Context Isolation**: `contextIsolation: true` enforced on all BrowserWindows.
- **Node Integration**: `nodeIntegration: false` strictly disabled in renderer.
- **Process Sandboxing**: `sandbox: true` enabled.
- **Content Security Policy**: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://127.0.0.1:* http://127.0.0.1:*`.
- **Navigation Defense**: `will-navigate` blocks all external links; `setWindowOpenHandler` denies all unvetted popups.

---

## 6. Phase Separation & Future Roadmap

- **Phase 1 (Completed)**: Foundation, spatial UI, custom orb, sound effects, settings persistence, global hotkey, native sidecar bridge, unit tests.
- **Phase 2 (Roadmap)**: Live generative AI connectivity (Gemini Live / DeepSeek), multi-turn reasoning agent loop.
- **Phase 3 (Roadmap)**: Autonomous desktop actions, secure sandboxed accessibility control.
- **Phase 4 (Roadmap)**: Screen perception pipeline (computer vision) and semantic memory mesh.
