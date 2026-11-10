package com.example.feedbackhub

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.browser.customtabs.CustomTabsIntent
import org.json.JSONObject
import java.util.Locale

/**
 * FeedbackHub - Android 极简接入客户端
 * 
 * 适用于独立开发者多产品矩阵：
 * 1. 默认自动采集并上传当前客户端设备的真实系统语言 (zh-CN, zh-TW, en, ja, ko, es, de, fr 等)
 * 2. 默认自动获取应用包名、版本号、设备机型与系统底层版本
 * 3. 支持 App 自主按产品深度自定义工单内容：自定义分类列表 (categories)、自定义标题 (title)、自定义描述 (desc)、自定义输入占位 (placeholder)
 * 4. 支持附加自定义业务参数 (如 uid, 会员状态, 路由节点等)
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
     * 自动探测客户端设备系统真实语言，规范化为支持的 8 种核心语言代码
     */
    fun detectDeviceLanguage(): String {
        val localeTag = Locale.getDefault().toLanguageTag().lowercase()
        return when {
            localeTag.startsWith("zh-tw") || localeTag.startsWith("zh-hk") || localeTag.startsWith("zh-mo") || localeTag.startsWith("zh-hant") -> "zh-tw"
            localeTag.startsWith("zh") -> "zh"
            localeTag.startsWith("ja") -> "ja"
            localeTag.startsWith("ko") -> "ko"
            localeTag.startsWith("es") -> "es"
            localeTag.startsWith("de") -> "de"
            localeTag.startsWith("fr") -> "fr"
            else -> "en"
        }
    }

    /**
     * 构建反馈中心 Webview / 浏览器跳转 URL
     *
     * @param context     Android Context
     * @param categories  App 自定义问题分类列表 (如 listOf("导出黑屏", "滤镜卡顿", "字幕错位", "功能建议"))
     * @param title       App 自定义工单主标题 (如 "视频剪辑用户反馈专区")
     * @param desc        App 自定义工单副标题描述 (如 "遇到转码或播放异常请直接提交")
     * @param placeholder App 自定义输入框占位符 (如 "请提供您的视频分辨率与复现步骤...")
     * @param extraData   附加私有业务参数字典 (如会员等级、设备指纹等)
     * @param lang        界面语言 (默认 null，自动读取并上传设备当前系统语言)
     * @param baseUrl     自定义 Worker 基础域名（默认使用内置生产域名）
     * @return 组装完成的 URL 字符串
     */
    fun buildUrl(
        context: Context,
        categories: List<String>? = null,
        title: String? = null,
        desc: String? = null,
        placeholder: String? = null,
        extraData: Map<String, Any>? = null,
        lang: String? = null,
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
        
        // 界面语言：默认让客户端自动上传真实设备语言，亦支持开发者显式指定覆盖
        val finalLang = if (!lang.isNullOrBlank()) lang.lowercase() else detectDeviceLanguage()

        val uriBuilder = Uri.parse(baseUrl).buildUpon()
            .appendQueryParameter("pkg", pkg)
            .appendQueryParameter("ver", versionName)
            .appendQueryParameter("os", osInfo)
            .appendQueryParameter("lang", finalLang)

        // 注入 App 自定义工单配置
        if (!categories.isNullOrEmpty()) {
            uriBuilder.appendQueryParameter("categories", categories.joinToString(","))
        }
        if (!title.isNullOrBlank()) {
            uriBuilder.appendQueryParameter("title", title)
        }
        if (!desc.isNullOrBlank()) {
            uriBuilder.appendQueryParameter("desc", desc)
        }
        if (!placeholder.isNullOrBlank()) {
            uriBuilder.appendQueryParameter("placeholder", placeholder)
        }

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
     * 极简调用（自动上传设备语言与系统信息）：
     * ```kotlin
     * FeedbackHub.open(this)
     * ```
     * 
     * 自定义工单内容调用（根据自身 App 特点配置分类与标题）：
     * ```kotlin
     * FeedbackHub.open(
     *     context = this,
     *     title = "FitFlow 健身反馈",
     *     desc = "动作库、周期记录与训练数据同步反馈",
     *     categories = listOf("数据同步失败", "动作库建议", "界面优化", "其他"),
     *     placeholder = "请描述您在做哪个动作或同步哪个设备时遇到的问题...",
     *     extraData = mapOf("plan" to "pro", "userId" to "usr_1002")
     * )
     * ```
     */
    fun open(
        context: Context,
        categories: List<String>? = null,
        title: String? = null,
        desc: String? = null,
        placeholder: String? = null,
        extraData: Map<String, Any>? = null,
        lang: String? = null,
        baseUrl: String = DEFAULT_BASE_URL
    ) {
        val url = buildUrl(
            context = context,
            categories = categories,
            title = title,
            desc = desc,
            placeholder = placeholder,
            extraData = extraData,
            lang = lang,
            baseUrl = baseUrl
        )
        try {
            val customTabsIntent = CustomTabsIntent.Builder()
                .setShowTitle(true)
                .build()
            customTabsIntent.launchUrl(context, Uri.parse(url))
        } catch (e: Exception) {
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(intent)
        }
    }

    /**
     * 向后兼容重载：仅传 extraData
     */
    fun open(
        context: Context,
        extraData: Map<String, Any>?,
        baseUrl: String = DEFAULT_BASE_URL
    ) {
        open(context = context, extraData = extraData, baseUrl = baseUrl)
    }
}
