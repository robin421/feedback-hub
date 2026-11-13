package com.example.feedbackhub

import android.annotation.SuppressLint
import android.app.Activity
import android.app.Dialog
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
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
 * 5. 在 App 内以全屏 WebView 页面打开（不跳出 App、不依赖浏览器），自动适配深色模式、状态栏与软键盘
 *
 * 无需额外依赖，也无需在 AndroidManifest 注册 Activity；只需 App 已声明网络权限：
 * <uses-permission android:name="android.permission.INTERNET" />
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
     * 在 App 内打开反馈中心（全屏 WebView 页面，不跳出 App）
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
     *     extraData = mapOf("plan" to "pro", "userId" to "usr_1002"),
     *     onSubmitted = { ticketId -> Log.d("Feedback", "submitted $ticketId") }
     * )
     * ```
     *
     * @param context     需为 Activity（或包裹 Activity 的 Context）；否则回退到系统浏览器
     * @param onSubmitted 工单提交成功回调（参数为工单号），可选
     * @param onClose     反馈页关闭回调，可选
     */
    fun open(
        context: Context,
        categories: List<String>? = null,
        title: String? = null,
        desc: String? = null,
        placeholder: String? = null,
        extraData: Map<String, Any>? = null,
        lang: String? = null,
        baseUrl: String = DEFAULT_BASE_URL,
        onSubmitted: ((ticketId: String) -> Unit)? = null,
        onClose: (() -> Unit)? = null
    ) {
        val finalLang = if (!lang.isNullOrBlank()) lang.lowercase() else detectDeviceLanguage()
        val url = Uri.parse(
            buildUrl(
                context = context,
                categories = categories,
                title = title,
                desc = desc,
                placeholder = placeholder,
                extraData = extraData,
                lang = finalLang,
                baseUrl = baseUrl
            )
        ).buildUpon().appendQueryParameter("embed", "1").build().toString()

        val activity = context.findActivity()
        if (activity == null || activity.isFinishing) {
            openInBrowser(context, url)
            return
        }
        FeedbackDialog(activity, url, toolbarTitle(finalLang), onSubmitted, onClose).show()
    }

    /**
     * 向后兼容重载：仅传 extraData（显式传入 categories = null 以命中完整版 open，避免自递归）
     */
    fun open(
        context: Context,
        extraData: Map<String, Any>?,
        baseUrl: String = DEFAULT_BASE_URL
    ) {
        open(context = context, categories = null, extraData = extraData, baseUrl = baseUrl)
    }

    /**
     * 备用方案：使用系统默认浏览器打开（会跳出 App）
     */
    fun openInBrowser(context: Context, url: String) {
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply {
            if (context !is Activity) addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(intent)
    }

    private fun toolbarTitle(lang: String): String = when (lang) {
        "zh" -> "意见反馈"
        "zh-tw" -> "意見回饋"
        "ja" -> "フィードバック"
        "ko" -> "피드백"
        "es" -> "Comentarios"
        "fr" -> "Commentaires"
        else -> "Feedback"
    }

    private tailrec fun Context.findActivity(): Activity? = when (this) {
        is Activity -> this
        is ContextWrapper -> baseContext.findActivity()
        else -> null
    }

    /**
     * 全屏反馈页：顶部原生标题栏 + 进度条 + WebView
     */
    private class FeedbackDialog(
        private val activity: Activity,
        private val url: String,
        private val toolbarTitle: String,
        private val onSubmitted: ((String) -> Unit)?,
        private val onClose: (() -> Unit)?
    ) {
        private val isNight = (activity.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
            Configuration.UI_MODE_NIGHT_YES
        private val bgColor = if (isNight) Color.parseColor("#0B0F19") else Color.parseColor("#F8FAFC")
        private val fgColor = if (isNight) Color.parseColor("#F1F5F9") else Color.parseColor("#0F172A")
        private val dividerColor = if (isNight) Color.parseColor("#1F2937") else Color.parseColor("#E2E8F0")
        private val allowedHost = Uri.parse(url).host
        private val mainHandler = Handler(Looper.getMainLooper())

        private val dialog = Dialog(
            activity,
            if (isNight) android.R.style.Theme_Material_NoActionBar else android.R.style.Theme_Material_Light_NoActionBar
        )
        private lateinit var webView: WebView

        private fun dp(value: Int): Int = TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_DIP, value.toFloat(), activity.resources.displayMetrics
        ).toInt()

        @SuppressLint("SetJavaScriptEnabled", "JavascriptInterface")
        fun show() {
            val root = LinearLayout(activity).apply {
                orientation = LinearLayout.VERTICAL
                setBackgroundColor(bgColor)
                fitsSystemWindows = false
            }

            // 顶部标题栏：居中标题 + 右侧关闭按钮
            val toolbar = FrameLayout(activity).apply {
                layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(52))
            }
            toolbar.addView(TextView(activity).apply {
                text = toolbarTitle
                setTextColor(fgColor)
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 17f)
                paint.isFakeBoldText = true
                layoutParams = FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER
                )
            })
            toolbar.addView(TextView(activity).apply {
                text = "✕"
                contentDescription = "Close"
                setTextColor(fgColor)
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 20f)
                gravity = Gravity.CENTER
                layoutParams = FrameLayout.LayoutParams(dp(52), dp(52), Gravity.END or Gravity.CENTER_VERTICAL)
                val outValue = TypedValue()
                activity.theme.resolveAttribute(android.R.attr.selectableItemBackgroundBorderless, outValue, true)
                setBackgroundResource(outValue.resourceId)
                setOnClickListener { dialog.dismiss() }
            })
            root.addView(toolbar)
            root.addView(View(activity).apply {
                setBackgroundColor(dividerColor)
                layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 1)
            })

            val progress = ProgressBar(activity, null, android.R.attr.progressBarStyleHorizontal).apply {
                max = 100
                layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(2))
            }
            root.addView(progress)

            webView = WebView(activity).apply {
                layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
                setBackgroundColor(bgColor)
                settings.javaScriptEnabled = true
                settings.domStorageEnabled = true
                settings.setSupportZoom(false)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    @Suppress("DEPRECATION")
                    settings.isAlgorithmicDarkeningAllowed = false // 页面自带深色模式，避免二次反色
                }
                addJavascriptInterface(Bridge(), "FeedbackHubNative")
                webChromeClient = object : WebChromeClient() {
                    override fun onProgressChanged(view: WebView, newProgress: Int) {
                        progress.progress = newProgress
                        progress.visibility = if (newProgress >= 100) View.GONE else View.VISIBLE
                    }
                }
                webViewClient = object : WebViewClient() {
                    // 只允许在反馈服务域名内跳转，其它链接 (邮件、外链等) 交给系统处理
                    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                        val target = request.url
                        if (target.host == allowedHost && (target.scheme == "https" || target.scheme == "http")) return false
                        try {
                            activity.startActivity(Intent(Intent.ACTION_VIEW, target))
                        } catch (_: Exception) {
                        }
                        return true
                    }
                }
            }
            root.addView(webView)

            // 适配沉浸式 (Android 15 edge-to-edge) 状态栏/导航栏与软键盘高度
            root.setOnApplyWindowInsetsListener { v, insets ->
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    val bars = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.ime())
                    v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
                } else {
                    @Suppress("DEPRECATION")
                    v.setPadding(
                        insets.systemWindowInsetLeft, insets.systemWindowInsetTop,
                        insets.systemWindowInsetRight, insets.systemWindowInsetBottom
                    )
                }
                insets
            }

            dialog.setContentView(root)
            dialog.window?.apply {
                setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
                setBackgroundDrawable(ColorDrawable(bgColor))
                @Suppress("DEPRECATION")
                setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
                @Suppress("DEPRECATION")
                statusBarColor = bgColor
                @Suppress("DEPRECATION")
                navigationBarColor = bgColor
                if (!isNight) {
                    @Suppress("DEPRECATION")
                    decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR or
                        (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR else 0)
                }
            }
            dialog.setOnDismissListener {
                webView.stopLoading()
                webView.removeJavascriptInterface("FeedbackHubNative")
                (webView.parent as? ViewGroup)?.removeView(webView)
                webView.destroy()
                onClose?.invoke()
            }

            webView.loadUrl(url)
            dialog.show()
        }

        /** 页面通过 window.FeedbackHubNative.postMessage(json) 通知原生 */
        private inner class Bridge {
            @JavascriptInterface
            fun postMessage(message: String) {
                mainHandler.post {
                    val json = try { JSONObject(message) } catch (_: Exception) { return@post }
                    when (json.optString("type")) {
                        "submitted" -> onSubmitted?.invoke(json.optJSONObject("payload")?.optString("ticketId").orEmpty())
                        "close" -> if (dialog.isShowing) dialog.dismiss()
                    }
                }
            }
        }
    }
}
