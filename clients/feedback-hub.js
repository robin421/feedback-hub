/**
 * FeedbackHub - Web & Chrome Extension 极简接入客户端
 * 
 * 适用于：
 * 1. 浏览器插件 (Chrome / Edge / Firefox Extension)
 * 2. 独立 Web 工具 / SaaS 网站 / 静态站点
 */
(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.FeedbackHub = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {

  const DEFAULT_BASE_URL = 'https://feedback-hub.robin421.workers.dev';

  /**
   * 判断当前是否处于 WebExtension (Chrome/Edge Extension) 上下文
   */
  function isExtensionEnvironment() {
    return typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.getManifest === 'function';
  }

  /**
   * 获取运行环境信息
   */
  async function detectEnvironment(defaultPkg = 'web.app') {
    let pkg = defaultPkg;
    let ver = '1.0.0';
    let os = 'Web Browser';

    if (isExtensionEnvironment()) {
      try {
        const manifest = chrome.runtime.getManifest();
        pkg = manifest.name ? manifest.name.toLowerCase().replace(/[^a-z0-9.]/g, '-') : defaultPkg;
        ver = manifest.version || '1.0.0';
        
        if (chrome.runtime.getPlatformInfo) {
          const platformInfo = await new Promise(resolve => chrome.runtime.getPlatformInfo(resolve));
          os = `Chrome Extension (${platformInfo.os} - ${platformInfo.arch})`;
        } else {
          os = 'Chrome Extension';
        }
      } catch (e) {
        console.warn('[FeedbackHub] Error reading extension metadata:', e);
      }
    } else if (typeof window !== 'undefined') {
      pkg = window.location.hostname || defaultPkg;
      os = navigator.userAgent.includes('Mac') ? 'macOS' :
           navigator.userAgent.includes('Win') ? 'Windows' :
           navigator.userAgent.includes('Linux') ? 'Linux' :
           navigator.userAgent.includes('Android') ? 'Android Web' :
           navigator.userAgent.includes('iPhone') ? 'iOS Web' : 'Web';
    }

    const navLang = (typeof navigator !== 'undefined' ? (navigator.language || 'en') : 'en').toLowerCase();
    let lang = 'en';
    if (navLang.startsWith('zh-tw') || navLang.startsWith('zh-hk') || navLang.startsWith('zh-hant')) {
      lang = 'zh-tw';
    } else if (navLang.startsWith('zh')) {
      lang = 'zh';
    } else if (navLang.startsWith('ja')) {
      lang = 'ja';
    } else if (navLang.startsWith('ko')) {
      lang = 'ko';
    } else if (navLang.startsWith('es')) {
      lang = 'es';
    } else if (navLang.startsWith('de')) {
      lang = 'de';
    } else if (navLang.startsWith('fr')) {
      lang = 'fr';
    }

    return { pkg, ver, os, lang };
  }

  /**
   * 构建反馈 URL
   * 
   * @param {Object} [options={}]
   * @param {string} [options.baseUrl] - 自定义 Worker 基础 URL (默认使用内置生产域名)
   * @param {string} [options.pkg] - 覆盖默认应用包名或标识 (例如 "ext.lockbox")
   * @param {string} [options.ver] - 覆盖版本号
   * @param {Object} [options.extra] - 附加业务参数 (如 { syncStatus: "offline", vaultId: 102 })
   */
  async function buildUrl({ baseUrl = DEFAULT_BASE_URL, pkg, ver, extra } = {}) {
    const env = await detectEnvironment(pkg);
    const finalPkg = pkg || env.pkg;
    const finalVer = ver || env.ver;

    const url = new URL(baseUrl);
    url.searchParams.set('pkg', finalPkg);
    url.searchParams.set('ver', finalVer);
    url.searchParams.set('os', env.os);
    url.searchParams.set('lang', env.lang);

    if (extra && typeof extra === 'object') {
      url.searchParams.set('extra', JSON.stringify(extra));
    }

    return url.toString();
  }

  /**
   * 一键调起反馈页面
   * 优先使用扩展自带的 chrome.tabs.create，Web 环境则使用 window.open
   * 
   * 极简示例（一行代码）：
   * FeedbackHub.open();
   * 
   * 带业务参数示例：
   * FeedbackHub.open({
   *   pkg: "ext.lockbox",
   *   extra: { autoFillSuccess: false, targetDomain: "example.com" }
   * });
   */
  async function open(options = {}) {
    const targetUrl = await buildUrl(options);

    if (isExtensionEnvironment() && chrome.tabs && chrome.tabs.create) {
      chrome.tabs.create({ url: targetUrl });
      return;
    }

    if (typeof window !== 'undefined') {
      window.open(targetUrl, '_blank', 'noopener,noreferrer');
    }
  }

  return {
    detectEnvironment,
    buildUrl,
    open
  };
}));
