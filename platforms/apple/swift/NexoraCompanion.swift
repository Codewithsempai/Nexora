// =============================================================================
// NEXORA — Native macOS Desktop Overlay & Menu Bar Controller
// Future Apple Platform Architecture (Phase 2+)
// =============================================================================

import Cocoa
import WebKit

/// Native floating HUD window for macOS target
public class NexoraFloatingPanel: NSPanel {
    public init(contentRect: NSRect) {
        super.init(
            contentRect: contentRect,
            styleMask: [.nonactivatingPanel, .borderless],
            backing: .buffered,
            defer: false
        )

        self.isFloatingPanel = true
        self.level = .floating
        self.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        self.backgroundColor = .clear
        self.isOpaque = false
        self.hasShadow = false
        self.ignoresMouseEvents = false
    }
}

/// Menu Bar Status Controller for macOS
public class NexoraStatusBarManager: NSObject {
    private var statusItem: NSStatusItem?
    public weak var delegate: NexoraBridgeProtocol?

    public override init() {
        super.init()
        setupStatusItem()
    }

    private func setupStatusItem() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        if let button = statusItem?.button {
            button.title = "✦" // Amber star symbol
            button.toolTip = "NEXORA Assistant"
        }

        let menu = NSMenu()
        menu.addItem(NSMenuItem(title: "NEXORA :: Active", action: nil, keyEquivalent: ""))
        menu.addItem(NSMenuItem.separator())
        menu.addItem(NSMenuItem(title: "Toggle HUD", action: #selector(toggleHUD), keyEquivalent: "n"))
        menu.addItem(NSMenuItem(title: "Quit", action: #selector(quitApp), keyEquivalent: "q"))

        statusItem?.menu = menu
    }

    @objc private func toggleHUD() {
        delegate?.didReceiveSystemEvent("toggle_hud", payload: [:])
    }

    @objc private func quitApp() {
        NSApplication.shared.terminate(nil)
    }
}
