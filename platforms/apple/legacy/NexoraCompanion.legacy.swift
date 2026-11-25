// NexoraCompanion.swift - Native macOS Desktop Overlay & Menu Bar Controller
// Provides a transparent, borderless floating HUD window and status bar integration for Nexora.

import Cocoa
import WebKit
import SwiftUI

// MARK: - Script Message Bridge Protocol
@objc protocol NexoraBridgeDelegate: AnyObject {
    func didUpdateVoiceLevel(_ level: Float)
    func didTriggerMoment(_ moment: String)
    func didChangeMode(_ mode: String)
}

// MARK: - WebKit Script Message Handler
class NexoraScriptHandler: NSObject, WKScriptMessageHandler {
    weak var delegate: NexoraBridgeDelegate?

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any],
              let event = body["event"] as? String else { return }

        switch event {
        case "voiceLevel":
            if let level = body["level"] as? Float {
                delegate?.didUpdateVoiceLevel(level)
            }
        case "moment":
            if let moment = body["moment"] as? String {
                delegate?.didTriggerMoment(moment)
            }
        case "mode":
            if let mode = body["mode"] as? String {
                delegate?.didChangeMode(mode)
            }
        default:
            break
        }
    }
}

// MARK: - Floating Desktop HUD Window
class NexoraHUDWindow: NSPanel {
    init(contentRect: NSRect) {
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

    func setClickThrough(_ enabled: Bool) {
        self.ignoresMouseEvents = enabled
    }
}

// MARK: - Window Controller
class NexoraHUDWindowController: NSWindowController, NexoraBridgeDelegate {
    private var webView: WKWebView!
    private var scriptHandler = NexoraScriptHandler()

    convenience init() {
        let screenSize = NSScreen.main?.visibleFrame.size ?? CGSize(width: 1440, height: 900)
        let windowWidth: CGFloat = 600
        let windowHeight: CGFloat = 520
        let rect = NSRect(
            x: screenSize.width - windowWidth - 40,
            y: 60,
            width: windowWidth,
            height: windowHeight
        )

        let window = NexoraHUDWindow(contentRect: rect)
        self.init(window: window)
        setupWebView()
    }

    private func setupWebView() {
        guard let window = self.window else { return }

        let config = WKWebViewConfiguration()
        let preferences = WKWebpagePreferences()
        preferences.allowsContentJavaScript = true
        config.defaultWebpagePreferences = preferences

        let contentController = WKUserContentController()
        scriptHandler.delegate = self
        contentController.add(scriptHandler, name: "nexoraBridge")
        config.userContentController = contentController

        webView = WKWebView(frame: window.contentView!.bounds, configuration: config)
        webView.autoresizingMask = [.width, .height]
        webView.setValue(false, forKey: "drawsBackground") // Transparent background

        window.contentView?.addSubview(webView)
        loadNexora()
    }

    func loadNexora() {
        // Loads from the local Rust server or embedded web bundle
        if let url = URL(string: "http://127.0.0.1:8080") {
            let request = URLRequest(url: url)
            webView.load(request)
        }
    }

    // Bridge actions to JavaScript
    func triggerMomentInWeb(glyph: String) {
        let js = "window.Nexie && window.Nexie.triggerMoment && window.Nexie.triggerMoment('\(glyph)');"
        webView.evaluateJavaScript(js, completionHandler: nil)
    }

    func setSidekickMode(_ mode: String) {
        let js = "window.Nexie && (window.Nexie.mode = '\(mode)');"
        webView.evaluateJavaScript(js, completionHandler: nil)
    }

    // MARK: - Delegate Callbacks
    func didUpdateVoiceLevel(_ level: Float) {
        // Handle voice activity on macOS side
    }

    func didTriggerMoment(_ moment: String) {
        NSSound.beep()
    }

    func didChangeMode(_ mode: String) {
        print("[Nexora Swift] Mode switched to: \(mode)")
    }
}

// MARK: - Menu Bar Status Controller
class NexoraMenuStatusController: NSObject {
    private var statusItem: NSStatusItem!
    private var windowController: NexoraHUDWindowController?

    init(windowController: NexoraHUDWindowController?) {
        self.windowController = windowController
        super.init()
        setupMenu()
    }

    private func setupMenu() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)

        if let button = statusItem.button {
            button.title = "🟣"
            button.toolTip = "Nexora Quantum Sidekick"
        }

        let menu = NSMenu()

        menu.addItem(NSMenuItem(title: "Nexora :: Online", action: nil, keyEquivalent: ""))
        menu.addItem(NSMenuItem.separator())

        let modesItem = NSMenuItem(title: "Sidekick Mode", action: nil, keyEquivalent: "")
        let subMenu = NSMenu()
        subMenu.addItem(NSMenuItem(title: "Rest", action: #selector(setModeRest), keyEquivalent: "1"))
        subMenu.addItem(NSMenuItem(title: "Talk", action: #selector(setModeTalk), keyEquivalent: "2"))
        subMenu.addItem(NSMenuItem(title: "Listen", action: #selector(setModeListen), keyEquivalent: "3"))
        subMenu.addItem(NSMenuItem(title: "Think", action: #selector(setModeThink), keyEquivalent: "4"))
        modesItem.submenu = subMenu
        menu.addItem(modesItem)

        let momentsItem = NSMenuItem(title: "Trigger Moment", action: nil, keyEquivalent: "")
        let momentMenu = NSMenu()
        momentMenu.addItem(NSMenuItem(title: "⚡ Bolt Spark", action: #selector(triggerBolt), keyEquivalent: "b"))
        momentMenu.addItem(NSMenuItem(title: "❤️ Heart Core", action: #selector(triggerHeart), keyEquivalent: "h"))
        momentMenu.addItem(NSMenuItem(title: "🔥 Flame Aura", action: #selector(triggerFlame), keyEquivalent: "f"))
        momentMenu.addItem(NSMenuItem(title: "💢 Anger Tremor", action: #selector(triggerAnger), keyEquivalent: "a"))
        momentsItem.submenu = momentMenu
        menu.addItem(momentsItem)

        menu.addItem(NSMenuItem.separator())
        menu.addItem(NSMenuItem(title: "Toggle Visibility", action: #selector(toggleWindow), keyEquivalent: "v"))
        menu.addItem(NSMenuItem(title: "Quit Nexora", action: #selector(quitApp), keyEquivalent: "q"))

        statusItem.menu = menu
    }

    @objc private func setModeRest() { windowController?.setSidekickMode("rest") }
    @objc private func setModeTalk() { windowController?.setSidekickMode("talk") }
    @objc private func setModeListen() { windowController?.setSidekickMode("listen") }
    @objc private func setModeThink() { windowController?.setSidekickMode("think") }

    @objc private func triggerBolt() { windowController?.triggerMomentInWeb(glyph: "bolt") }
    @objc private func triggerHeart() { windowController?.triggerMomentInWeb(glyph: "heart") }
    @objc private func triggerFlame() { windowController?.triggerMomentInWeb(glyph: "flame") }
    @objc private func triggerAnger() { windowController?.triggerMomentInWeb(glyph: "anger") }

    @objc private func toggleWindow() {
        guard let win = windowController?.window else { return }
        if win.isVisible {
            win.orderOut(nil)
        } else {
            win.makeKeyAndOrderFront(nil)
        }
    }

    @objc private func quitApp() {
        NSApplication.shared.terminate(nil)
    }
}
