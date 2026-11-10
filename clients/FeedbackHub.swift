import UIKit
import SafariServices

/**
 * FeedbackHub - iOS 极简接入客户端
 * 
 * 适用于独立开发者多产品矩阵：自动获取 Bundle ID、App 版本、系统机型与语言，
 * 并支持使用 SFSafariViewController 在 App 内无缝调起反馈页（支持深色模式自适应）。
 */
public final class FeedbackHub {

    /// 默认 Cloudflare Workers 生产环境线上域名
    public static let defaultBaseUrl = "https://feedback-hub.robin421.workers.dev"

    /**
     * 构建反馈中心目标 URL
     * 
     * - Parameters:
     *   - extraData: 附加业务参数字典 (如 ["userId": "10023", "plan": "premium"])
     *   - baseUrl: 自定义 Worker 基础 URL (默认使用内置生产域名)
     */
    public static func buildUrl(
        extraData: [String: Any]? = nil,
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

        let preferredLang = (Locale.preferredLanguages.first ?? "en").lowercased()
        let lang: String
        if preferredLang.starts(with: "zh-tw") || preferredLang.starts(with: "zh-hk") || preferredLang.starts(with: "zh-hant") {
            lang = "zh-tw"
        } else if preferredLang.starts(with: "zh") {
            lang = "zh"
        } else if preferredLang.starts(with: "ja") {
            lang = "ja"
        } else if preferredLang.starts(with: "ko") {
            lang = "ko"
        } else if preferredLang.starts(with: "es") {
            lang = "es"
        } else if preferredLang.starts(with: "de") {
            lang = "de"
        } else if preferredLang.starts(with: "fr") {
            lang = "fr"
        } else {
            lang = "en"
        }

        var queryItems: [URLQueryItem] = [
            URLQueryItem(name: "pkg", value: bundleId),
            URLQueryItem(name: "ver", value: fullVersion),
            URLQueryItem(name: "os", value: osInfo),
            URLQueryItem(name: "lang", value: lang)
        ]

        if let extra = extraData,
           let jsonData = try? JSONSerialization.data(withJSONObject: extra, options: []),
           let jsonString = String(data: jsonData, encoding: .utf8) {
            queryItems.append(URLQueryItem(name: "extra", value: jsonString))
        }

        components.queryItems = queryItems
        return components.url
    }

    /**
     * 在指定 UIViewController 内弹出 SFSafariViewController 打开反馈页
     * 
     * 极简示例（一行代码）：
     * FeedbackHub.present(from: self)
     * 
     * 带业务参数示例：
     * FeedbackHub.present(from: self, extraData: ["plan": "pro", "userId": "usr_998"])
     */
    public static func present(
        from viewController: UIViewController,
        extraData: [String: Any]? = nil,
        baseUrl: String = defaultBaseUrl
    ) {
        guard let url = buildUrl(extraData: extraData, baseUrl: baseUrl) else {
            print("[FeedbackHub] Error: Invalid URL generated.")
            return
        }

        let safariVC = SFSafariViewController(url: url)
        safariVC.dismissButtonStyle = .close
        safariVC.modalPresentationStyle = .pageSheet
        viewController.present(safariVC, animated: true)
    }

    /**
     * 备用方案：直接调用系统默认外部浏览器打开
     */
    public static func openInBrowser(
        extraData: [String: Any]? = nil,
        baseUrl: String = defaultBaseUrl
    ) {
        guard let url = buildUrl(extraData: extraData, baseUrl: baseUrl) else { return }
        UIApplication.shared.open(url, options: [:], completionHandler: nil)
    }
}
