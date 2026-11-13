import UIKit
import WebKit

/**
 * FeedbackHub - iOS 极简接入客户端
 * 
 * 适用于独立开发者多产品矩阵：
 * 1. 默认自动采集并上传当前设备真实系统语言 (zh-CN, zh-TW, en, ja, ko, es, de, fr 等)
 * 2. 默认自动获取 Bundle ID、App 版本与构建号、iOS 系统机型
 * 3. 支持 App 自主按产品深度自定义工单内容：自定义分类列表 (categories)、自定义标题 (title)、自定义描述 (desc)、自定义输入占位 (placeholder)
 * 4. 在 App 内以原生页面 (WKWebView) 弹出，不跳出 App、无 Safari 地址栏；深色模式自适应，支持下拉关闭
 * 5. 支持提交成功 / 关闭回调
 */
public final class FeedbackHub {

    /// 默认 Cloudflare Workers 生产环境线上域名
    public static let defaultBaseUrl = "https://feedback-hub.robin421.workers.dev"

    /**
     * 自动探测设备当前真实系统语言并规范化为核心 8 种语言代码
     */
    public static func detectDeviceLanguage() -> String {
        let preferredLang = (Locale.preferredLanguages.first ?? "en").lowercased()
        if preferredLang.starts(with: "zh-tw") || preferredLang.starts(with: "zh-hk") || preferredLang.starts(with: "zh-mo") || preferredLang.starts(with: "zh-hant") {
            return "zh-tw"
        } else if preferredLang.starts(with: "zh") {
            return "zh"
        } else if preferredLang.starts(with: "ja") {
            return "ja"
        } else if preferredLang.starts(with: "ko") {
            return "ko"
        } else if preferredLang.starts(with: "es") {
            return "es"
        } else if preferredLang.starts(with: "de") {
            return "de"
        } else if preferredLang.starts(with: "fr") {
            return "fr"
        } else {
            return "en"
        }
    }

    /**
     * 构建反馈中心目标 URL
     * 
     * - Parameters:
     *   - categories: App 自定义问题分类列表 (如 ["导出黑屏", "滤镜失效", "音频错位", "功能建议"])
     *   - title: App 自定义工单主标题 (如 "视频剪辑用户反馈")
     *   - desc: App 自定义工单副标题描述 (如 "遇到转码或播放异常请直接提交")
     *   - placeholder: App 自定义输入框占位符
     *   - extraData: 附加私有业务参数字典 (如 ["userId": "10023", "plan": "premium"])
     *   - lang: 界面语言 (默认 nil，自动检测并上传真实设备语言)
     *   - baseUrl: 自定义 Worker 基础 URL (默认使用内置生产域名)
     */
    public static func buildUrl(
        categories: [String]? = nil,
        title: String? = nil,
        desc: String? = nil,
        placeholder: String? = nil,
        extraData: [String: Any]? = nil,
        lang: String? = nil,
        baseUrl: String = defaultBaseUrl
    ) -> URL? {
        guard var components = URLComponents(string: baseUrl) else { return nil }

        let bundleId = Bundle.main.bundleIdentifier ?? "default"
        let appVersion = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0.0"
        let buildNumber = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "1"
        let fullVersion = "\(appVersion)(\(buildNumber))"

        let systemName = UIDevice.current.systemName
        let systemVersion = UIDevice.current.systemVersion
        let model = UIDevice.current.model
        let osInfo = "\(systemName) \(systemVersion) - \(model)"

        // 默认让客户端自动上传真实设备语言，亦支持开发者显式指定覆盖
        let finalLang = (lang != nil && !lang!.isEmpty) ? lang!.lowercased() : detectDeviceLanguage()

        var queryItems: [URLQueryItem] = [
            URLQueryItem(name: "pkg", value: bundleId),
            URLQueryItem(name: "ver", value: fullVersion),
            URLQueryItem(name: "os", value: osInfo),
            URLQueryItem(name: "lang", value: finalLang)
        ]

        // 注入 App 自定义工单配置
        if let cats = categories, !cats.isEmpty {
            queryItems.append(URLQueryItem(name: "categories", value: cats.joined(separator: ",")))
        }
        if let customTitle = title, !customTitle.isEmpty {
            queryItems.append(URLQueryItem(name: "title", value: customTitle))
        }
        if let customDesc = desc, !customDesc.isEmpty {
            queryItems.append(URLQueryItem(name: "desc", value: customDesc))
        }
        if let customPlaceholder = placeholder, !customPlaceholder.isEmpty {
            queryItems.append(URLQueryItem(name: "placeholder", value: customPlaceholder))
        }

        // 附加业务 JSON 参数
        if let extra = extraData,
           let jsonData = try? JSONSerialization.data(withJSONObject: extra, options: []),
           let jsonString = String(data: jsonData, encoding: .utf8) {
            queryItems.append(URLQueryItem(name: "extra", value: jsonString))
        }

        components.queryItems = queryItems
        // URLQueryItem 不会转义 "+"，服务端会将其解析为空格，这里手动转义
        components.percentEncodedQuery = components.percentEncodedQuery?.replacingOccurrences(of: "+", with: "%2B")
        return components.url
    }

    /**
     * 在 App 内弹出反馈页（原生 WKWebView 页面，不跳出 App）
     *
     * 极简示例（一行代码）：
     * ```swift
     * FeedbackHub.present(from: self)
     * ```
     *
     * App 自定义工单内容示例：
     * ```swift
     * FeedbackHub.present(
     *     from: self,
     *     categories: ["视频黑屏", "滤镜卡顿", "字幕错位", "其他建议"],
     *     title: "剪辑大师用户反馈",
     *     desc: "遇到转码或播放异常请直接提交，工程师全力排查",
     *     placeholder: "请提供您的视频分辨率与复现步骤...",
     *     extraData: ["plan": "pro", "userId": "usr_998"],
     *     onSubmitted: { ticketId in print("submitted \(ticketId)") }
     * )
     * ```
     */
    public static func present(
        from viewController: UIViewController,
        categories: [String]? = nil,
        title: String? = nil,
        desc: String? = nil,
        placeholder: String? = nil,
        extraData: [String: Any]? = nil,
        lang: String? = nil,
        baseUrl: String = defaultBaseUrl,
        onSubmitted: ((String) -> Void)? = nil,
        onClose: (() -> Void)? = nil
    ) {
        let finalLang = (lang?.isEmpty == false) ? lang!.lowercased() : detectDeviceLanguage()
        guard let url = buildUrl(
            categories: categories,
            title: title,
            desc: desc,
            placeholder: placeholder,
            extraData: extraData,
            lang: finalLang,
            baseUrl: baseUrl
        ),
        var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            print("[FeedbackHub] Error: Invalid URL generated.")
            return
        }
        components.percentEncodedQuery = (components.percentEncodedQuery ?? "") + "&embed=1"
        guard let embedUrl = components.url else { return }

        let feedbackVC = FeedbackWebViewController(url: embedUrl, onSubmitted: onSubmitted, onClose: onClose)
        feedbackVC.title = toolbarTitle(for: finalLang)
        let nav = UINavigationController(rootViewController: feedbackVC)
        nav.modalPresentationStyle = .pageSheet
        nav.presentationController?.delegate = feedbackVC
        viewController.present(nav, animated: true)
    }

    /**
     * 备用方案：直接调用系统默认外部浏览器打开（会跳出 App）
     */
    public static func openInBrowser(
        categories: [String]? = nil,
        title: String? = nil,
        desc: String? = nil,
        placeholder: String? = nil,
        extraData: [String: Any]? = nil,
        lang: String? = nil,
        baseUrl: String = defaultBaseUrl
    ) {
        guard let url = buildUrl(
            categories: categories,
            title: title,
            desc: desc,
            placeholder: placeholder,
            extraData: extraData,
            lang: lang,
            baseUrl: baseUrl
        ) else { return }
        UIApplication.shared.open(url, options: [:], completionHandler: nil)
    }

    static func toolbarTitle(for lang: String) -> String {
        switch lang {
        case "zh": return "意见反馈"
        case "zh-tw": return "意見回饋"
        case "ja": return "フィードバック"
        case "ko": return "피드백"
        case "es": return "Comentarios"
        case "fr": return "Commentaires"
        default: return "Feedback"
        }
    }
}

// MARK: - 内置反馈页面 (WKWebView)

final class FeedbackWebViewController: UIViewController, WKNavigationDelegate, UIAdaptivePresentationControllerDelegate {

    private let url: URL
    private let onSubmitted: ((String) -> Void)?
    private let onClose: (() -> Void)?
    private var webView: WKWebView!
    private let progressView = UIProgressView(progressViewStyle: .bar)
    private var progressObservation: NSKeyValueObservation?
    private var didNotifyClose = false

    init(url: URL, onSubmitted: ((String) -> Void)?, onClose: (() -> Void)?) {
        self.url = url
        self.onSubmitted = onSubmitted
        self.onClose = onClose
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor { $0.userInterfaceStyle == .dark
            ? UIColor(red: 0x0B / 255, green: 0x0F / 255, blue: 0x19 / 255, alpha: 1)
            : UIColor(red: 0xF8 / 255, green: 0xFA / 255, blue: 0xFC / 255, alpha: 1) }

        navigationItem.rightBarButtonItem = UIBarButtonItem(barButtonSystemItem: .close, target: self, action: #selector(closeTapped))

        let config = WKWebViewConfiguration()
        // 使用弱引用代理，避免 WKUserContentController 强持有导致内存泄漏
        config.userContentController.add(WeakScriptMessageHandler(self), name: "feedbackHub")
        config.websiteDataStore = .default() // 保留 localStorage (提交频率限制等)

        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        webView.scrollView.contentInsetAdjustmentBehavior = .automatic
        webView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(webView)

        progressView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(progressView)

        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            progressView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            progressView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            progressView.trailingAnchor.constraint(equalTo: view.trailingAnchor)
        ])

        progressObservation = webView.observe(\.estimatedProgress, options: [.new]) { [weak self] webView, _ in
            guard let self = self else { return }
            self.progressView.progress = Float(webView.estimatedProgress)
            self.progressView.isHidden = webView.estimatedProgress >= 1
        }

        webView.load(URLRequest(url: url))
    }

    deinit {
        progressObservation?.invalidate()
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: "feedbackHub")
    }

    @objc private func closeTapped() {
        dismissFeedback()
    }

    private func dismissFeedback() {
        dismiss(animated: true) { [weak self] in self?.notifyClose() }
    }

    private func notifyClose() {
        guard !didNotifyClose else { return }
        didNotifyClose = true
        onClose?()
    }

    // 下拉手势关闭 pageSheet
    func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
        notifyClose()
    }

    // 只允许在反馈服务域名内跳转，其它链接 (邮件、外链等) 交给系统处理
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let target = navigationAction.request.url else { return decisionHandler(.cancel) }
        if target.host == url.host || target.scheme == "about" {
            decisionHandler(.allow)
        } else {
            UIApplication.shared.open(target)
            decisionHandler(.cancel)
        }
    }

    fileprivate func handleMessage(_ body: Any) {
        guard let text = body as? String,
              let data = text.data(using: .utf8),
              let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let type = json["type"] as? String else { return }
        let payload = json["payload"] as? [String: Any] ?? [:]
        switch type {
        case "submitted":
            onSubmitted?(payload["ticketId"] as? String ?? "")
        case "close":
            dismissFeedback()
        default:
            break
        }
    }
}

private final class WeakScriptMessageHandler: NSObject, WKScriptMessageHandler {
    private weak var target: FeedbackWebViewController?

    init(_ target: FeedbackWebViewController) {
        self.target = target
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.handleMessage(message.body)
    }
}
