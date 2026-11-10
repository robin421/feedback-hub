import 'dart:convert';
import 'dart:io';

/**
 * FeedbackHub - Flutter 跨平台接入客户端
 * 
 * 适用于独立开发者多产品矩阵：在 Android、iOS、macOS、Windows 上均可便捷构建反馈链接。
 * 
 * 依赖建议（在 pubspec.yaml 中添加）：
 * dependencies:
 *   url_launcher: ^6.3.0
 *   # 可选，若需要自动获取当前 App 包名和版本号：
 *   # package_info_plus: ^8.0.0
 */
class FeedbackHub {
  /// 默认 Cloudflare Workers 生产环境线上域名
  static const String defaultBaseUrl = 'https://feedback-hub.robin421.workers.dev';

  /// 构建反馈中心目标 URI
  ///
  /// [packageName]: 应用包名/Bundle ID (如 "com.turboLink.fast")
  /// [appVersion]: 应用版本号 (如 "1.2.0")
  /// [extraData]: 附加业务参数 Map (如 {"uid": "user_88", "region": "APAC"})
  /// [baseUrl]: 自定义 Worker 基础 URL (默认使用内置生产域名)
  static Uri buildUri({
    required String packageName,
    String appVersion = '1.0.0',
    Map<String, dynamic>? extraData,
    String baseUrl = defaultBaseUrl,
  }) {
    final osInfo = '${Platform.operatingSystem} ${Platform.operatingSystemVersion}';
    final locale = Platform.localeName.toLowerCase();
    final String lang;
    if (locale.startsWith('zh-tw') || locale.startsWith('zh-hk') || locale.startsWith('zh-hant')) {
      lang = 'zh-tw';
    } else if (locale.startsWith('zh')) {
      lang = 'zh';
    } else if (locale.startsWith('ja')) {
      lang = 'ja';
    } else if (locale.startsWith('ko')) {
      lang = 'ko';
    } else if (locale.startsWith('es')) {
      lang = 'es';
    } else if (locale.startsWith('de')) {
      lang = 'de';
    } else if (locale.startsWith('fr')) {
      lang = 'fr';
    } else {
      lang = 'en';
    }

    final queryParams = <String, String>{
      'pkg': packageName,
      'ver': appVersion,
      'os': osInfo,
      'lang': lang,
    };

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
  ///   extraData: {'plan': 'premium'},
  /// );
  /// ```
  static Future<bool> open({
    required String packageName,
    String appVersion = '1.0.0',
    Map<String, dynamic>? extraData,
    String baseUrl = defaultBaseUrl,
    Function(Uri url)? customLauncher,
  }) async {
    final targetUri = buildUri(
      baseUrl: baseUrl,
      packageName: packageName,
      appVersion: appVersion,
      extraData: extraData,
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
