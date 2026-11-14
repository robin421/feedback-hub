/**
 * FeedbackHub - React Native & Web 纯 TypeScript 接入客户端（零第三方依赖）
 *
 * 适用于：
 * - React Native / Expo (iOS / Android / Web)
 * - 任何支持标准 fetch 与 AbortController 的 TypeScript/JavaScript 运行时
 */

export const DEFAULT_FEEDBACK_HUB_URL = 'https://feedback-hub.robin421.workers.dev';
export const DEFAULT_TIMEOUT_MS = 15_000;

export type FeedbackValidationErrorCode =
  | 'invalid_category'
  | 'content_empty';

export interface FeedbackValidationInput {
  category?: string | null;
  content?: string | null;
}

export interface FeedbackValidationResult {
  valid: boolean;
  error?: FeedbackValidationErrorCode;
}

export interface FeedbackTicketInput {
  pkg: string;
  ver?: string;
  os?: string;
  lang?: string;
  category: string;
  content: string;
  email?: string;
  extra?: Record<string, unknown> | string | null;
}

export interface SubmitFeedbackOptions {
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface SubmitFeedbackResult {
  ok: boolean;
  ticketId?: string;
  issueNumber?: number | null;
  issueUrl?: string | null;
  error?: string;
  status?: number;
}

interface FeedbackApiResponse {
  success?: boolean;
  message?: string;
  error?: string;
  data?: {
    ticket_id?: string;
    issue_number?: number | null;
    issue_url?: string | null;
  };
}

const SUPPORTED_BASE_LANGUAGES = new Set(['en', 'ja', 'ko', 'es', 'de', 'fr']);

/**
 * 将设备/界面 locale 归一为 Feedback Hub 支持的语言代码。
 * 支持：en, zh, zh-tw, ja, ko, es, de, fr；其余回退到 en。
 */
export function resolveFeedbackLanguage(locale: string): string {
  if (typeof locale !== 'string' || !locale.trim()) {
    return 'en';
  }
  const normalized = locale.trim().toLowerCase().replace(/_/g, '-');
  if (/^zh-(tw|hk|mo|hant)(-|$)/.test(normalized)) {
    return 'zh-tw';
  }
  if (/^zh(-|$)/.test(normalized)) {
    return 'zh';
  }
  const base = normalized.split('-')[0];
  return SUPPORTED_BASE_LANGUAGES.has(base) ? base : 'en';
}

/**
 * 校验工单分类与正文非空（不限制字符长度），返回结构化校验结果。
 */
export function validateFeedbackPayload(
  input: FeedbackValidationInput,
): FeedbackValidationResult {
  if (!input || typeof input.category !== 'string' || input.category.trim().length === 0) {
    return { valid: false, error: 'invalid_category' };
  }
  const trimmedContent = typeof input.content === 'string' ? input.content.trim() : '';
  if (trimmedContent.length === 0) {
    return { valid: false, error: 'content_empty' };
  }
  return { valid: true };
}

/**
 * 向 Feedback Hub `/api/submit` 提交工单。
 * 自带客户端校验与 15 秒超时保护（AbortController），绝不抛出未捕获异常。
 */
export async function submitFeedbackTicket(
  input: FeedbackTicketInput,
  options?: SubmitFeedbackOptions,
): Promise<SubmitFeedbackResult> {
  const validation = validateFeedbackPayload(input);
  if (!validation.valid) {
    return { ok: false, error: validation.error };
  }

  const fetchFn = options?.fetchImpl ?? globalThis.fetch;
  if (typeof fetchFn !== 'function') {
    return { ok: false, error: 'fetch_unavailable' };
  }

  const rawBaseUrl = options?.baseUrl?.trim() || DEFAULT_FEEDBACK_HUB_URL;
  const endpoint = `${rawBaseUrl.replace(/\/+$/, '')}/api/submit`;
  const timeoutMs =
    typeof options?.timeoutMs === 'number' && options.timeoutMs > 0
      ? options.timeoutMs
      : DEFAULT_TIMEOUT_MS;

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : undefined;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : undefined;

  const body = {
    pkg: (input.pkg || 'default').trim(),
    ver: (input.ver || '1.0.0').trim(),
    os: (input.os || 'Unknown').trim(),
    lang: resolveFeedbackLanguage(input.lang ?? 'en'),
    category: input.category.trim(),
    content: input.content.trim(),
    email: typeof input.email === 'string' ? input.email.trim() : '',
    extra: input.extra ?? null,
    website_url: '',
  };

  try {
    const response = await fetchFn(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller?.signal,
    });

    let parsed: FeedbackApiResponse | null = null;
    try {
      parsed = (await response.json()) as FeedbackApiResponse;
    } catch {
      parsed = null;
    }

    if (response.ok && parsed?.success !== false) {
      return {
        ok: true,
        ticketId: parsed?.data?.ticket_id,
        issueNumber: parsed?.data?.issue_number ?? null,
        issueUrl: parsed?.data?.issue_url ?? null,
        status: response.status,
      };
    }

    return {
      ok: false,
      error: parsed?.error || parsed?.message || `HTTP ${response.status}`,
      status: response.status,
    };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { ok: false, error: 'timeout' };
    }
    if (err instanceof Error && err.message) {
      return { ok: false, error: err.message };
    }
    return { ok: false, error: 'network_error' };
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}
