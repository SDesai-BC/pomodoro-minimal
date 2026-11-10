import Cocoa
import WebKit
@preconcurrency import UserNotifications

final class BundleSchemeHandler: NSObject, WKURLSchemeHandler {
    private let webRootURL: URL

    init(webRootURL: URL) {
        self.webRootURL = webRootURL
        super.init()
    }

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let requestURL = urlSchemeTask.request.url else {
            urlSchemeTask.didFailWithError(NSError(domain: "KansoSchemeError", code: 400, userInfo: [
                NSLocalizedDescriptionKey: "Missing URL in scheme task request"
            ]))
            return
        }

        var relativePath = requestURL.path
        if relativePath.isEmpty || relativePath == "/" {
            relativePath = "/index.html"
        }
        let cleanRelative = relativePath.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        let targetURL = webRootURL.appendingPathComponent(cleanRelative).standardizedFileURL

        guard targetURL.path.hasPrefix(webRootURL.standardizedFileURL.path) else {
            urlSchemeTask.didFailWithError(NSError(domain: "KansoSchemeError", code: 403, userInfo: [
                NSLocalizedDescriptionKey: "Forbidden path outside web root: \(cleanRelative)"
            ]))
            return
        }

        do {
            let data = try Data(contentsOf: targetURL)
            let mimeType = Self.mimeType(forExtension: targetURL.pathExtension)
            let response = HTTPURLResponse(
                url: requestURL,
                statusCode: 200,
                httpVersion: "HTTP/1.1",
                headerFields: [
                    "Content-Type": mimeType,
                    "Content-Length": "\(data.count)",
                    "Cache-Control": "no-cache"
                ]
            )!
            urlSchemeTask.didReceive(response)
            urlSchemeTask.didReceive(data)
            urlSchemeTask.didFinish()
        } catch {
            urlSchemeTask.didFailWithError(error)
        }
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}

    private static func mimeType(forExtension ext: String) -> String {
        switch ext.lowercased() {
        case "html": return "text/html; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "js", "mjs": return "application/javascript; charset=utf-8"
        case "json", "webmanifest": return "application/manifest+json; charset=utf-8"
        case "png": return "image/png"
        case "svg": return "image/svg+xml"
        case "ico": return "image/x-icon"
        default: return "application/octet-stream"
        }
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, WKScriptMessageHandler, UNUserNotificationCenterDelegate, NSWindowDelegate {
    private var window: NSWindow!
    private var webView: WKWebView!
    private var statusItem: NSStatusItem!
    private var bannerPanel: NSPanel?
    private var bannerDismissWorkItem: DispatchWorkItem?
    private let persistentStorageKey = "kanso_pomodoro_v1"

    func applicationDidFinishLaunching(_ notification: Notification) {
        setupMainMenu()
        setupStatusBarItem()
        configureNotifications()
        setupMainWindow()
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag {
            window?.makeKeyAndOrderFront(nil)
        }
        return true
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return false
    }

    private func setupStatusBarItem() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        if let button = statusItem.button {
            button.font = NSFont.monospacedDigitSystemFont(ofSize: 12, weight: .medium)
            button.title = "○ 25:00"
            button.target = self
            button.action = #selector(toggleMainWindow)
            button.toolTip = "Kanso Pomodoro — Click to show or hide window"
        }
    }

    @objc private func toggleMainWindow() {
        guard let win = window else { return }
        if win.isVisible && NSApp.isActive {
            win.orderOut(nil)
        } else {
            win.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
        }
    }

    private func configureNotifications() {
        let center = UNUserNotificationCenter.current()
        center.delegate = self
        center.requestAuthorization(options: [.alert, .sound, .badge]) { granted, error in
            if let error = error {
                NSLog("[Kanso Pomodoro] Notification permission error: \(error.localizedDescription)")
            }
        }
    }

    private func setupMainWindow() {
        guard let resourceURL = Bundle.main.resourceURL else {
            fatalError("[Kanso Pomodoro] Missing Bundle.main.resourceURL")
        }
        let webRootURL = resourceURL.appendingPathComponent("web", isDirectory: true)

        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        let schemeHandler = BundleSchemeHandler(webRootURL: webRootURL)
        config.setURLSchemeHandler(schemeHandler, forURLScheme: "kanso")
        config.userContentController.add(self, name: "kansoNative")

        // Restore permanent backup from UserDefaults if WebKit localStorage is ever empty
        if let backedUpJSON = UserDefaults.standard.string(forKey: persistentStorageKey),
           let encodedData = try? JSONSerialization.data(withJSONObject: [backedUpJSON]),
           let jsonArrayString = String(data: encodedData, encoding: .utf8) {
            let restoreScript = """
            try {
              const backup = (\(jsonArrayString))[0];
              if (backup && !localStorage.getItem("kanso_pomodoro_v1")) {
                localStorage.setItem("kanso_pomodoro_v1", backup);
              }
            } catch (err) {
              console.warn("[Kanso native restore] Failed to restore backup:", err);
            }
            """
            let userScript = WKUserScript(
                source: restoreScript,
                injectionTime: .atDocumentStart,
                forMainFrameOnly: true
            )
            config.userContentController.addUserScript(userScript)
        }

        let rect = NSRect(x: 0, y: 0, width: 1020, height: 760)
        // Standard native macOS titlebar (not covered by WKWebView) so dragging the window works natively
        window = NSWindow(
            contentRect: rect,
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Kanso Pomodoro"
        window.titlebarAppearsTransparent = true
        window.isMovableByWindowBackground = true
        window.minSize = NSSize(width: 460, height: 600)
        window.center()
        window.setFrameAutosaveName("KansoPomodoroMainWindow")
        window.delegate = self

        webView = WKWebView(frame: rect, configuration: config)
        webView.autoresizingMask = [.width, .height]
        webView.setValue(false, forKey: "drawsBackground")
        window.contentView = webView

        if let startURL = URL(string: "kanso://app/index.html") {
            webView.load(URLRequest(url: startURL))
        }
        window.makeKeyAndOrderFront(nil)
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "kansoNative",
              let payload = message.body as? [String: Any],
              let type = payload["type"] as? String else {
            return
        }

        switch type {
        case "startWindowDrag":
            if let currentEvent = NSApp.currentEvent {
                self.window?.performDrag(with: currentEvent)
            }
        case "persistState":
            if let serialized = payload["serialized"] as? String {
                UserDefaults.standard.set(serialized, forKey: persistentStorageKey)
            }
        case "requestPermission":
            self.configureNotifications()
        case "notify":
            let title = payload["title"] as? String ?? "Kanso Pomodoro"
            let body = payload["body"] as? String ?? ""
            let silent = payload["silent"] as? Bool ?? false
            self.deliverNativeNotification(title: title, body: body, silent: silent)
        case "timerTick":
            let formattedTime = payload["formattedTime"] as? String ?? "25:00"
            let isRunning = payload["isRunning"] as? Bool ?? false
            let symbol = isRunning ? "◉" : "○"
            self.statusItem?.button?.title = "\(symbol) \(formattedTime)"
        default:
            break
        }
    }

    private func deliverNativeNotification(title: String, body: String, silent: Bool) {
        showFloatingBanner(title: title, body: body)

        let center = UNUserNotificationCenter.current()
        center.getNotificationSettings { settings in
            guard settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional else {
                return
            }
            let content = UNMutableNotificationContent()
            content.title = title
            content.body = body
            // Web Audio synthesizer plays the user's selected sound profile unless silent is true
            content.sound = nil

            let request = UNNotificationRequest(
                identifier: "kanso-phase-\(UUID().uuidString)",
                content: content,
                trigger: nil
            )
            center.add(request, withCompletionHandler: nil)
        }
    }

    private func showFloatingBanner(title: String, body: String) {
        bannerDismissWorkItem?.cancel()
        bannerPanel?.orderOut(nil)

        let width: CGFloat = 340
        let height: CGFloat = 78
        let screenFrame = (window?.screen ?? NSScreen.main)?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let panelRect = NSRect(
            x: screenFrame.maxX - width - 18,
            y: screenFrame.maxY - height - 14,
            width: width,
            height: height
        )

        let panel = NSPanel(
            contentRect: panelRect,
            styleMask: [.nonactivatingPanel, .borderless],
            backing: .buffered,
            defer: false
        )
        panel.level = .statusBar
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]

        let effectView = NSVisualEffectView(frame: NSRect(x: 0, y: 0, width: width, height: height))
        effectView.material = .hudWindow
        effectView.blendingMode = .behindWindow
        effectView.state = .active
        effectView.wantsLayer = true
        effectView.layer?.cornerRadius = 14
        effectView.layer?.masksToBounds = true
        effectView.layer?.borderWidth = 1
        effectView.layer?.borderColor = NSColor.separatorColor.cgColor

        let dot = NSView(frame: NSRect(x: 16, y: height - 30, width: 10, height: 10))
        dot.wantsLayer = true
        dot.layer?.backgroundColor = NSColor(srgbRed: 0.388, green: 0.663, blue: 1.0, alpha: 1.0).cgColor
        dot.layer?.cornerRadius = 5

        let titleLabel = NSTextField(labelWithString: title)
        titleLabel.font = NSFont.systemFont(ofSize: 13, weight: .semibold)
        titleLabel.textColor = .labelColor
        titleLabel.frame = NSRect(x: 34, y: height - 34, width: width - 48, height: 18)

        let bodyLabel = NSTextField(wrappingLabelWithString: body)
        bodyLabel.font = NSFont.systemFont(ofSize: 12, weight: .regular)
        bodyLabel.textColor = .secondaryLabelColor
        bodyLabel.frame = NSRect(x: 34, y: 10, width: width - 48, height: 34)

        effectView.addSubview(dot)
        effectView.addSubview(titleLabel)
        effectView.addSubview(bodyLabel)
        panel.contentView = effectView

        panel.alphaValue = 0
        panel.orderFrontRegardless()
        NSAnimationContext.runAnimationGroup { ctx in
            ctx.duration = 0.2
            panel.animator().alphaValue = 1
        }
        self.bannerPanel = panel

        let workItem = DispatchWorkItem { [weak self] in
            Task { @MainActor in
                guard let currentPanel = self?.bannerPanel else { return }
                NSAnimationContext.runAnimationGroup({ ctx in
                    ctx.duration = 0.25
                    currentPanel.animator().alphaValue = 0
                }, completionHandler: {
                    Task { @MainActor in
                        currentPanel.orderOut(nil)
                    }
                })
            }
        }
        self.bannerDismissWorkItem = workItem
        DispatchQueue.main.asyncAfter(deadline: .now() + 4.5, execute: workItem)
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .list, .sound])
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        Task { @MainActor in
            self.window?.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
        }
        completionHandler()
    }

    private func setupMainMenu() {
        let mainMenu = NSMenu()

        let appMenuItem = NSMenuItem()
        mainMenu.addItem(appMenuItem)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "About Kanso Pomodoro", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(withTitle: "Hide Kanso Pomodoro", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(withTitle: "Quit Kanso Pomodoro", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appMenuItem.submenu = appMenu

        let editMenuItem = NSMenuItem()
        mainMenu.addItem(editMenuItem)
        let editMenu = NSMenu(title: "Edit")
        editMenu.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editMenuItem.submenu = editMenu

        let windowMenuItem = NSMenuItem()
        mainMenu.addItem(windowMenuItem)
        let windowMenu = NSMenu(title: "Window")
        windowMenu.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        windowMenu.addItem(withTitle: "Close Window", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        windowMenuItem.submenu = windowMenu

        NSApp.mainMenu = mainMenu
    }
}

let app = NSApplication.shared
let delegate = MainActor.assumeIsolated { AppDelegate() }
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
