import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:webview_flutter/webview_flutter.dart';

/**
 * FeedbackHub - Flutter 跨平台接入客户端
 * 
 * 适用于独立开发者多产品矩阵：在 Android、iOS、macOS、Windows、Web 上均可便捷接入。
 * 1. 默认自动采集并上传设备真实系统语言 (zh-CN, zh-TW, en, ja, ko, es, de, fr 等)
 * 2. 默认自动组装底层操作系统与硬件环境参数
 * 3. 支持 App 自主按产品深度自定义工单内容：自定义分类列表 (categories)、自定义标题 (title)、自定义描述 (desc)、自定义输入占位 (placeholder)
 * 4. 支持附加业务私有字典 (extraData)
 * 5. 在 App 内以原生页面 (WebView) 打开，不跳出 App；支持提交成功 / 关闭回调
 *
 * 依赖（在 pubspec.yaml 中添加）：
 * dependencies:
 *   webview_flutter: ^4.10.0
 *   url_launcher: ^6.3.0   # 仅用于在系统中打开页面内的外部链接 / 降级打开
 */
class FeedbackHub {
  /// 默认 Cloudflare Workers 生产环境线上域名
  static const String defaultBaseUrl = 'https://feedback-hub.robin421.workers.dev';

  /// 自动探测设备当前真实系统语言并规范化为核心 8 语种代码
  static String detectDeviceLanguage() {
    final locale = Platform.localeName.toLowerCase().replaceAll('_', '-'); // 如 zh_Hant_TW -> zh-hant-tw
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

  /// 在 App 内打开反馈中心（原生 WebView 页面，不跳出 App）
  ///
  /// 示例用法：
  /// ```dart
  /// final ticketId = await FeedbackHub.open(
  ///   context,
  ///   packageName: 'com.yourcompany.app',
  ///   title: '我的应用用户反馈',
  ///   categories: ['功能卡顿', '闪退崩溃', '产品建议', '其他'],
  ///   extraData: {'plan': 'premium'},
  /// );
  /// // ticketId 为 null 表示用户未提交就关闭了页面
  /// ```
  static Future<String?> open(
    BuildContext context, {
    required String packageName,
    String appVersion = '1.0.0',
    List<String>? categories,
    String? title,
    String? desc,
    String? placeholder,
    Map<String, dynamic>? extraData,
    String? lang,
    String baseUrl = defaultBaseUrl,
    void Function(String ticketId)? onSubmitted,
  }) {
    final finalLang = (lang != null && lang.trim().isNotEmpty) ? lang.trim().toLowerCase() : detectDeviceLanguage();
    final uri = buildUri(
      baseUrl: baseUrl,
      packageName: packageName,
      appVersion: appVersion,
      categories: categories,
      title: title,
      desc: desc,
      placeholder: placeholder,
      extraData: extraData,
      lang: finalLang,
    );
    final embedUri = uri.replace(queryParameters: {...uri.queryParameters, 'embed': '1'});

    return Navigator.of(context).push<String>(
      MaterialPageRoute(
        fullscreenDialog: true,
        builder: (_) => FeedbackHubPage(
          url: embedUri,
          title: toolbarTitle(finalLang),
          onSubmitted: onSubmitted,
        ),
      ),
    );
  }

  /// 备用方案：使用系统浏览器打开（会跳出 App）
  static Future<bool> openInBrowser(Uri uri) {
    return launchUrl(uri, mode: LaunchMode.externalApplication);
  }

  static String toolbarTitle(String lang) {
    switch (lang) {
      case 'zh':
        return '意见反馈';
      case 'zh-tw':
        return '意見回饋';
      case 'ja':
        return 'フィードバック';
      case 'ko':
        return '피드백';
      case 'es':
        return 'Comentarios';
      case 'fr':
        return 'Commentaires';
      default:
        return 'Feedback';
    }
  }
}

/// 内置反馈页面：AppBar + 进度条 + WebView
///
/// 关闭页面时通过 Navigator.pop 返回已提交的工单号（未提交则为 null）。
class FeedbackHubPage extends StatefulWidget {
  const FeedbackHubPage({
    super.key,
    required this.url,
    required this.title,
    this.onSubmitted,
  });

  final Uri url;
  final String title;
  final void Function(String ticketId)? onSubmitted;

  @override
  State<FeedbackHubPage> createState() => _FeedbackHubPageState();
}

class _FeedbackHubPageState extends State<FeedbackHubPage> {
  late final WebViewController _controller;
  int _progress = 0;
  String? _ticketId;

  @override
  void initState() {
    super.initState();
    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(Colors.transparent)
      ..addJavaScriptChannel('FeedbackHubNative', onMessageReceived: _onMessage)
      ..setNavigationDelegate(NavigationDelegate(
        onProgress: (p) {
          if (mounted) setState(() => _progress = p);
        },
        // 只允许在反馈服务域名内跳转，其它链接 (邮件、外链等) 交给系统处理
        onNavigationRequest: (request) {
          final target = Uri.tryParse(request.url);
          if (target == null || target.host == widget.url.host || target.scheme == 'about') {
            return NavigationDecision.navigate;
          }
          launchUrl(target, mode: LaunchMode.externalApplication);
          return NavigationDecision.prevent;
        },
      ))
      ..loadRequest(widget.url);
  }

  void _onMessage(JavaScriptMessage message) {
    Map<String, dynamic> json;
    try {
      json = jsonDecode(message.message) as Map<String, dynamic>;
    } catch (_) {
      return;
    }
    switch (json['type']) {
      case 'submitted':
        final payload = json['payload'];
        _ticketId = payload is Map ? (payload['ticketId']?.toString() ?? '') : '';
        widget.onSubmitted?.call(_ticketId!);
        break;
      case 'close':
        if (mounted) Navigator.of(context).pop(_ticketId);
        break;
    }
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final bg = isDark ? const Color(0xFF0B0F19) : const Color(0xFFF8FAFC);
    return PopScope<String>(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) Navigator.of(context).pop(_ticketId);
      },
      child: Scaffold(
        backgroundColor: bg,
        appBar: AppBar(
          backgroundColor: bg,
          surfaceTintColor: Colors.transparent,
          elevation: 0,
          centerTitle: true,
          automaticallyImplyLeading: false,
          title: Text(widget.title, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w600)),
          actions: [
            IconButton(
              icon: const Icon(Icons.close),
              tooltip: MaterialLocalizations.of(context).closeButtonTooltip,
              onPressed: () => Navigator.of(context).pop(_ticketId),
            ),
          ],
          bottom: _progress < 100
              ? PreferredSize(
                  preferredSize: const Size.fromHeight(2),
                  child: LinearProgressIndicator(value: _progress / 100, minHeight: 2),
                )
              : null,
        ),
        body: SafeArea(top: false, child: WebViewWidget(controller: _controller)),
      ),
    );
  }
}
