import UIKit
import SafariServices

/**
 * FeedbackHub - iOS 极简接入客户端
 * 
 * 适用于独立开发者多产品矩阵：
 * 1. 默认自动采集并上传当前设备真实系统语言 (zh-CN, zh-TW, en, ja, ko, es, de, fr 等)
 * 2. 默认自动获取 Bundle ID、App 版本与构建号、iOS 系统机型
 * 3. 支持 App 自主按产品深度自定义工单内容：自定义分类列表 (categories)、自定义标题 (title)、自定义描述 (desc)、自定义输入占位 (placeholder)
 * 4. 支持使用 SFSafariViewController 在 App 内无缝弹出（深色模式自适应，支持手势下拉关闭）
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
        return components.url
    }

    /**
     * 向后兼容重载：仅传 extraData
     */
    public static func buildUrl(
        extraData: [String: Any]? = nil,
        baseUrl: String = defaultBaseUrl
    ) -> URL? {
        return buildUrl(
            categories: nil,
            title: nil,
            desc: nil,
            placeholder: nil,
            extraData: extraData,
            lang: nil,
            baseUrl: baseUrl
        )
    }

    /**
     * 在指定 UIViewController 内弹出 SFSafariViewController 打开反馈页
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
     *     extraData: ["plan": "pro", "userId": "usr_998"]
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
        ) else {
            print("[FeedbackHub] Error: Invalid URL generated.")
            return
        }

        let safariVC = SFSafariViewController(url: url)
        safariVC.dismissButtonStyle = .close
        safariVC.modalPresentationStyle = .pageSheet
        viewController.present(safariVC, animated: true)
    }

    /**
     * 向后兼容重载：仅传 extraData
     */
    public static func present(
        from viewController: UIViewController,
        extraData: [String: Any]? = nil,
        baseUrl: String = defaultBaseUrl
    ) {
        present(
            from: viewController,
            categories: nil,
            title: nil,
            desc: nil,
            placeholder: nil,
            extraData: extraData,
            lang: nil,
            baseUrl: baseUrl
        )
    }

    /**
     * 备用方案：直接调用系统默认外部浏览器打开
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
}
