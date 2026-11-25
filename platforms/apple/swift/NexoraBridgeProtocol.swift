// =============================================================================
// NEXORA — Apple Platform Bridge Protocol
// Future macOS / iOS integration architecture (Phase 2+).
// =============================================================================

import Foundation

/// Bridge protocol for bidirectional communication between Swift native shell
/// and the NEXORA WebKit core.
@objc public protocol NexoraBridgeProtocol: AnyObject {
    /// Dispatched when the Quantum Orb state changes
    func didChangeOrbState(_ state: String)

    /// Dispatched when audio level harmonics are updated
    func didUpdateVoiceHarmonics(_ level: Float)

    /// Dispatched when an assistant acoustic trigger is fired
    func didTriggerSoundEffect(_ effectName: String)

    /// Dispatched when system hotkey or status change occurs
    func didReceiveSystemEvent(_ eventName: String, payload: [String: Any])
}

/// Typed representation of Orb State on macOS
@objc public enum NexoraOrbState: Int {
    case idle = 0
    case listening = 1
    case thinking = 2
    case speaking = 3
    case wake = 4
    case offline = 5
    case error = 6

    public var identifier: String {
        switch self {
        case .idle: return "idle"
        case .listening: return "listening"
        case .thinking: return "thinking"
        case .speaking: return "speaking"
        case .wake: return "wake"
        case .offline: return "offline"
        case .error: return "error"
        }
    }
}
