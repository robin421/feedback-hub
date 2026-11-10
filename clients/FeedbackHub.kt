package com.example.feedbackhub

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.browser.customtabs.CustomTabsIntent
import org.json.JSONObject
import java.net.URLEncoder
import java.util.Locale

/**
 * FeedbackHub - Android 极简接入客户端
 * 
 * 适用于独立开发者多产品矩阵：自动获取包名、版本号、设备机型、系统版本与语言，
 * 并支持附加自定义业务参数 (如 uid, 会员状态, 路由节点等)。
 * 
 * 依赖建议（可选，若使用 CustomTabs）：
 * implementation("androidx.browser:browser:1.8.0")
 */
object FeedbackHub {

    /**
     * 默认 Cloudflare Workers 生产环境线上域名
     */
    const val DEFAULT_BASE_URL: String = "https://feedback-hub.robin421.workers.dev"

    /**
     * 构建反馈中心 Webview / 浏览器跳转 URL
     *
     * @param context   Android Context
     * @param extraData 附加私有业务参数字典 (如会员等级、设备指纹等)
     * @param baseUrl   自定义域名（默认使用内置生产域名）
     * @return 组装完成的 URL 字符串
     */
    fun buildUrl(
        context: Context,
        extraData: Map<String, Any>? = null,
        baseUrl: String = DEFAULT_BASE_URL
    ): String {
        val pm = context.packageManager
        val pkg = context.packageName
        val versionName = try {
            val pInfo = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                pm.getPackageInfo(pkg, android.content.pm.PackageManager.PackageInfoFlags.of(0))
            } else {
                @Suppress("DEPRECATION")
                pm.getPackageInfo(pkg, 0)
            }
            pInfo.versionName ?: "1.0.0"
        } catch (e: Exception) {
            "1.0.0"
        }

        // 设备与系统信息: e.g. "Android 14 (API 34) - Google Pixel 7"
        val osInfo = "Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT}) - ${Build.MANUFACTURER} ${Build.MODEL}"
        
        // 界面语言简码: "zh" 或 "en"
        val lang = if (Locale.getDefault().language.startsWith("zh")) "zh" else "en"

        val uriBuilder = Uri.parse(baseUrl).buildUpon()
            .appendQueryParameter("pkg", pkg)
            .appendQueryParameter("ver", versionName)
            .appendQueryParameter("os", osInfo)
            .appendQueryParameter("lang", lang)

        // 附加业务 JSON 参数
        if (!extraData.isNullOrEmpty()) {
            val json = JSONObject(extraData).toString()
            uriBuilder.appendQueryParameter("extra", json)
        }

        return uriBuilder.build().toString()
    }

    /**
     * 调起反馈中心（优先使用极速且体验原生的 Chrome Custom Tabs）
     * 
     * 极简示例（一行代码）：
     * FeedbackHub.open(this)
     * 
     * 带业务参数示例：
     * FeedbackHub.open(this, mapOf("plan" to "pro", "userId" to "usr_1002"))
     */
    fun open(
        context: Context,
        extraData: Map<String, Any>? = null,
        baseUrl: String = DEFAULT_BASE_URL
    ) {
        val url = buildUrl(context, extraData, baseUrl)
        try {
            // 尝试使用 Chrome Custom Tabs
            val customTabsIntent = CustomTabsIntent.Builder()
                .setShowTitle(true)
                .build()
            customTabsIntent.launchUrl(context, Uri.parse(url))
        } catch (e: Exception) {
            // 降级使用系统外部浏览器打开
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(intent)
        }
    }
}
