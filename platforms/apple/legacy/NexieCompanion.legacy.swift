// NexieCompanion.swift - Native macOS Desktop Overlay & Menu Bar Controller
// Provides a transparent, borderless floating HUD window and status bar integration for Nexie JARVIS.

import Cocoa
import WebKit
import SwiftUI

// MARK: - Script Message Bridge Protocol
@objc protocol NexieBridgeDelegate: AnyObject {
    func didUpdateVoiceLevel(_ level: Float)
    func didTriggerMoment(_ moment: String)
    func didChangeMode(_ mode: String)
}

// MARK: - WebKit Script Message Handler
class NexieScriptHandler: NSObject, WKScriptMessageHandler {
    weak var delegate: NexieBridgeDelegate?

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
class NexieHUDWindow: NSPanel {
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
class NexieHUDWindowController: NSWindowController, NexieBridgeDelegate {
    private var webView: WKWebView!
    private var scriptHandler = NexieScriptHandler()

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

        let window = NexieHUDWindow(contentRect: rect)
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
        contentController.add(scriptHandler, name: "nexieBridge")
        config.userContentController = contentController

        webView = WKWebView(frame: window.contentView!.bounds, configuration: config)
        webView.autoresizingMask = [.width, .height]
        webView.setValue(false, forKey: "drawsBackground") // Transparent background

        window.contentView?.addSubview(webView)
        loadNexie()
    }

    func loadNexie() {
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
        print("[Nexie Swift] Mode switched to: \(mode)")
    }
}

// MARK: - macOS Menu Bar Status Item Controller
class NexieMenuBarApp: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem!
    private var hudController: NexieHUDWindowController!

    func applicationDidFinishLaunching(_ notification: Notification) {
        hudController = NexieHUDWindowController()
        hudController.showWindow(nil)

        setupStatusItem()
    }

    private func setupStatusItem() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)

        if let button = statusItem.button {
            button.title = "🟣 Nexie"
            button.toolTip = "Nexie JARVIS Sidekick"
        }

        let menu = NSMenu()

        // Mode submenu
        let modeMenu = NSMenu()
        modeMenu.addItem(NSMenuItem(title: "Rest", action: #selector(setModeRest), keyEquivalent: "1"))
        modeMenu.addItem(NSMenuItem(title: "Talk", action: #selector(setModeTalk), keyEquivalent: "2"))
        modeMenu.addItem(NSMenuItem(title: "Listen", action: #selector(setModeListen), keyEquivalent: "3"))
        modeMenu.addItem(NSMenuItem(title: "Think", action: #selector(setModeThink), keyEquivalent: "4"))

        let modeItem = NSMenuItem(title: "Mode", action: nil, keyEquivalent: "")
        modeItem.submenu = modeMenu
        menu.addItem(modeItem)

        // Moments submenu
        let momentsMenu = NSMenu()
        momentsMenu.addItem(NSMenuItem(title: "⚡ Bolt", action: #selector(triggerBolt), keyEquivalent: "b"))
        momentsMenu.addItem(NSMenuItem(title: "❤️ Heart", action: #selector(triggerHeart), keyEquivalent: "h"))
        momentsMenu.addItem(NSMenuItem(title: "🔥 Flame", action: #selector(triggerFlame), keyEquivalent: "f"))
        momentsMenu.addItem(NSMenuItem(title: "💢 Anger", action: #selector(triggerAnger), keyEquivalent: "a"))
        momentsMenu.addItem(NSMenuItem(title: "⏰ Clock", action: #selector(triggerClock), keyEquivalent: "c"))

        let momentsItem = NSMenuItem(title: "Moments", action: nil, keyEquivalent: "")
        momentsItem.submenu = momentsMenu
        menu.addItem(momentsItem)

        menu.addItem(NSMenuItem.separator())
        menu.addItem(NSMenuItem(title: "Toggle Window", action: #selector(toggleHUD), keyEquivalent: "t"))
        menu.addItem(NSMenuItem(title: "Quit Nexie", action: #selector(quitApp), keyEquivalent: "q"))

        statusItem.menu = menu
    }

    @objc private func setModeRest() { hudController.setSidekickMode("rest") }
    @objc private func setModeTalk() { hudController.setSidekickMode("talk") }
    @objc private func setModeListen() { hudController.setSidekickMode("listen") }
    @objc private func setModeThink() { hudController.setSidekickMode("think") }

    @objc private func triggerBolt() { hudController.triggerMomentInWeb(glyph: "bolt") }
    @objc private func triggerHeart() { hudController.triggerMomentInWeb(glyph: "heart") }
    @objc private func triggerFlame() { hudController.triggerMomentInWeb(glyph: "flame") }
    @objc private func triggerAnger() { hudController.triggerMomentInWeb(glyph: "anger") }
    @objc private func triggerClock() { hudController.triggerMomentInWeb(glyph: "clock") }

    @objc private func toggleHUD() {
        if let window = hudController.window {
            if window.isVisible { window.orderOut(nil) } else { window.makeKeyAndOrderFront(nil) }
        }
    }

    @objc private func quitApp() {
        NSApplication.shared.terminate(nil)
    }
}
