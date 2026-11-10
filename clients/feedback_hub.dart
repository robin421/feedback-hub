import 'dart:convert';
import 'dart:io';

/**
 * FeedbackHub - Flutter 跨平台接入客户端
 * 
 * 适用于独立开发者多产品矩阵：在 Android、iOS、macOS、Windows、Web 上均可便捷接入。
 * 1. 默认自动采集并上传设备真实系统语言 (zh-CN, zh-TW, en, ja, ko, es, de, fr 等)
 * 2. 默认自动组装底层操作系统与硬件环境参数
 * 3. 支持 App 自主按产品深度自定义工单内容：自定义分类列表 (categories)、自定义标题 (title)、自定义描述 (desc)、自定义输入占位 (placeholder)
 * 4. 支持附加业务私有字典 (extraData)
 * 
 * 依赖建议（在 pubspec.yaml 中添加）：
 * dependencies:
 *   url_launcher: ^6.3.0
 */
class FeedbackHub {
  /// 默认 Cloudflare Workers 生产环境线上域名
  static const String defaultBaseUrl = 'https://feedback-hub.robin421.workers.dev';

  /// 自动探测设备当前真实系统语言并规范化为核心 8 语种代码
  static String detectDeviceLanguage() {
    final locale = Platform.localeName.toLowerCase();
    if (locale.startsWith('zh-tw') || locale.startsWith('zh-hk') || locale.startsWith('zh-mo') || locale.startsWith('zh-hant')) {
      return 'zh-tw';
    } else if (locale.startsWith('zh')) {
      return 'zh';
    } else if (locale.startsWith('ja')) {
      return 'ja';
    } else if (locale.startsWith('ko')) {
      return 'ko';
    } else if (locale.startsWith('es')) {
      return 'es';
    } else if (locale.startsWith('de')) {
      return 'de';
    } else if (locale.startsWith('fr')) {
      return 'fr';
    } else {
      return 'en';
    }
  }

  /// 构建反馈中心目标 URI
  ///
  /// [packageName]: 应用包名/Bundle ID (如 "com.turboLink.fast")
  /// [categories]: App 自定义问题分类列表 (如 ["视频黑屏", "滤镜失效", "音频错位", "功能建议"])
  /// [title]: App 自定义工单主标题 (如 "视频剪辑用户反馈")
  /// [desc]: App 自定义工单副标题描述 (如 "遇到转码或播放异常请直接提交")
  /// [placeholder]: App 自定义输入框占位提示语
  /// [appVersion]: 应用版本号 (如 "1.2.0")
  /// [extraData]: 附加业务参数 Map (如 {"uid": "user_88", "region": "APAC"})
  /// [lang]: 界面语言 (默认 null，自动探测并上传真实设备语言)
  /// [baseUrl]: 自定义 Worker 基础 URL (默认使用内置生产域名)
  static Uri buildUri({
    required String packageName,
    String appVersion = '1.0.0',
    List<String>? categories,
    String? title,
    String? desc,
    String? placeholder,
    Map<String, dynamic>? extraData,
    String? lang,
    String baseUrl = defaultBaseUrl,
  }) {
    final osInfo = '${Platform.operatingSystem} ${Platform.operatingSystemVersion}';
    final finalLang = (lang != null && lang.trim().isNotEmpty) ? lang.trim().toLowerCase() : detectDeviceLanguage();

    final queryParams = <String, String>{
      'pkg': packageName,
      'ver': appVersion,
      'os': osInfo,
      'lang': finalLang,
    };

    // 注入 App 自定义工单配置
    if (categories != null && categories.isNotEmpty) {
      queryParams['categories'] = categories.join(',');
    }
    if (title != null && title.trim().isNotEmpty) {
      queryParams['title'] = title.trim();
    }
    if (desc != null && desc.trim().isNotEmpty) {
      queryParams['desc'] = desc.trim();
    }
    if (placeholder != null && placeholder.trim().isNotEmpty) {
      queryParams['placeholder'] = placeholder.trim();
    }

    if (extraData != null && extraData.isNotEmpty) {
      queryParams['extra'] = jsonEncode(extraData);
    }

    final baseUri = Uri.parse(baseUrl);
    return baseUri.replace(queryParameters: queryParams);
  }

  /// 调起反馈中心（使用 url_launcher）
  ///
  /// 示例用法：
  /// ```dart
  /// await FeedbackHub.open(
  ///   packageName: 'com.yourcompany.app',
  ///   title: '我的应用用户反馈',
  ///   categories: ['功能卡顿', '闪退崩溃', '产品建议', '其他'],
  ///   extraData: {'plan': 'premium'},
  /// );
  /// ```
  static Future<bool> open({
    required String packageName,
    String appVersion = '1.0.0',
    List<String>? categories,
    String? title,
    String? desc,
    String? placeholder,
    Map<String, dynamic>? extraData,
    String? lang,
    String baseUrl = defaultBaseUrl,
    Function(Uri url)? customLauncher,
  }) async {
    final targetUri = buildUri(
      baseUrl: baseUrl,
      packageName: packageName,
      appVersion: appVersion,
      categories: categories,
      title: title,
      desc: desc,
      placeholder: placeholder,
      extraData: extraData,
      lang: lang,
    );

    if (customLauncher != null) {
      customLauncher(targetUri);
      return true;
    }

    // 若工程中已引入 url_launcher，可直接解除以下注释：
    /*
    import 'package:url_launcher/url_launcher.dart';
    if (await canLaunchUrl(targetUri)) {
      return await launchUrl(
        targetUri,
        mode: LaunchMode.inAppBrowserView, // 支持应用内无缝弹出
      );
    }
    */

    return false;
  }
}
