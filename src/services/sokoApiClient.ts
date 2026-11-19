/**
 * SokoKuu TZ — Centralized Typed API Client
 * Handles Bearer token injection, transparent 401 refresh rotation with single-flight mutex,
 * automatic X-Idempotency-Key generation, RFC 7807 error parsing, and strict network vs HTTP error separation.
 */

export const getApiBaseUrl = (): string => {
  return (import.meta.env.VITE_API_BASE_URL as string) || '/api/v1';
};

export class SokoNetworkError extends Error {
  readonly isNetworkError = true;
  constructor(message = 'Backend server unreachable. Operating in offline mode.') {
    super(message);
    this.name = 'SokoNetworkError';
  }
}

export class SokoHttpError extends Error {
  readonly status: number;
  readonly response: unknown;
  readonly detail?: string;
  constructor(status: number, message: string, response?: unknown, detail?: string) {
    super(message);
    this.name = 'SokoHttpError';
    this.status = status;
    this.response = response;
    this.detail = detail;
  }
}

export function isSokoNetworkError(error: unknown): boolean {
  if (error instanceof SokoNetworkError) return true;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true;
  // A Vite/reverse-proxy 502/503/504 means the upstream NestJS service is not
  // reachable. Treat it as offline so the PWA cache is used instead of showing
  // a raw "Bad Gateway" error. Real application HTTP errors still surface.
  if (
    error instanceof SokoHttpError &&
    (error.status === 502 || error.status === 503 || error.status === 504)
  ) {
    return true;
  }
  // HTTP failures are wrapped in SokoHttpError and must surface to the user.
  // A bare TypeError here would misclassify coding errors as "offline".
  return false;
}

export async function checkBackendHealth(timeoutMs = 2500): Promise<{
  online: boolean;
  status?: string;
}> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { online: false };
  }
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${getApiBaseUrl()}/health`, {
      method: 'GET',
      signal: controller.signal,
    });
    if (!res.ok) {
      return { online: false };
    }
    const data = await res.json().catch(() => ({}));
    return { online: true, status: String((data as { status?: string }).status ?? 'OK') };
  } catch {
    return { online: false };
  } finally {
    window.clearTimeout(timer);
  }
}

let isRefreshing = false;
let failedQueue: Array<{
  resolve: (token: string) => void;
  reject: (err: unknown) => void;
}> = [];

const processQueue = (error: unknown, token: string | null = null) => {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token!);
    }
  });
  failedQueue = [];
};

async function parseResponseOrThrow<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const errorBody = await response
      .json()
      .catch(() => ({ message: response.statusText || `HTTP ${response.status}` }));
    const rawMsg =
      (errorBody as { detail?: string; message?: string | string[]; error?: string }).detail ||
      (errorBody as { message?: string | string[] }).message ||
      (errorBody as { error?: string }).error ||
      `HTTP error ${response.status}`;
    const formattedMsg = Array.isArray(rawMsg) ? rawMsg.join(', ') : String(rawMsg);
    throw new SokoHttpError(response.status, formattedMsg, errorBody, formattedMsg);
  }

  const contentType = response.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    return (await response.json()) as T;
  }
  return (await response.text()) as unknown as T;
}

export class SokoApiClient {
  private static getAccessToken(): string | null {
    return localStorage.getItem('sokokuu_access_token');
  }

  private static getRefreshToken(): string | null {
    return localStorage.getItem('sokokuu_refresh_token');
  }

  static setTokens(accessToken: string, refreshToken?: string) {
    localStorage.setItem('sokokuu_access_token', accessToken);
    if (refreshToken) {
      localStorage.setItem('sokokuu_refresh_token', refreshToken);
    }
  }

  static hasAccessToken(): boolean {
    return Boolean(this.getAccessToken());
  }

  static clearTokens() {
    localStorage.removeItem('sokokuu_access_token');
    localStorage.removeItem('sokokuu_refresh_token');
  }

  static getActiveUser(): {
    id?: string;
    businessId?: string | null;
    role?: string;
    phoneE164?: string;
    fullName?: string;
  } | null {
    if (typeof window === 'undefined') return null;
    try {
      const raw = localStorage.getItem('sokokuu_active_user_v1');
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        if (parsed && typeof parsed === 'object') {
          return {
            id: typeof parsed.userId === 'string'
              ? parsed.userId
              : typeof parsed.id === 'string'
                ? parsed.id
                : undefined,
            businessId:
              typeof parsed.businessId === 'string' ? parsed.businessId : null,
            role: typeof parsed.role === 'string' ? parsed.role : undefined,
            phoneE164:
              typeof parsed.phoneE164 === 'string' ? parsed.phoneE164 : undefined,
            fullName:
              typeof parsed.fullName === 'string' ? parsed.fullName : undefined,
          };
        }
      }
      const token = this.getAccessToken();
      if (!token) return null;
      const parts = token.split('.');
      if (parts.length !== 3) return null;
      const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const payload = JSON.parse(atob(base64)) as Record<string, unknown>;
      return {
        id: typeof payload.sub === 'string' ? payload.sub : undefined,
        businessId:
          typeof payload.businessId === 'string' ? payload.businessId : null,
        role: typeof payload.role === 'string' ? payload.role : undefined,
        phoneE164:
          typeof payload.phoneE164 === 'string' ? payload.phoneE164 : undefined,
      };
    } catch {
      return null;
    }
  }

  private static async refreshAccessToken(): Promise<string | null> {
    const refreshToken = this.getRefreshToken();
    if (!refreshToken) return null;

    try {
      const res = await fetch(`${getApiBaseUrl()}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });

      if (!res.ok) {
        this.clearTokens();
        return null;
      }

      const data = await res.json();
      const newAccessToken = data.accessToken || data.token;
      const newRefreshToken = data.refreshToken;
      if (newAccessToken) {
        this.setTokens(newAccessToken, newRefreshToken);
        return newAccessToken;
      }
      return null;
    } catch {
      return null;
    }
  }

  static async request<T = any>(
    endpoint: string,
    options: RequestInit = {},
    requiresAuth = true,
  ): Promise<T> {
    const baseUrl = getApiBaseUrl();
    const url = endpoint.startsWith('http')
      ? endpoint
      : `${baseUrl}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;

    const headers = new Headers(options.headers || {});
    if (!headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }

    const method = (options.method || 'GET').toUpperCase();
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      if (!headers.has('X-Idempotency-Key')) {
        headers.set('X-Idempotency-Key', crypto.randomUUID());
      }
    }

    if (requiresAuth) {
      const token = this.getAccessToken();
      if (token) {
        headers.set('Authorization', `Bearer ${token}`);
      }
    }

    const config: RequestInit = {
      ...options,
      headers,
      // SokoKuu API responses are authoritative. Avoid browser revalidation
      // 304s, which otherwise surface as parse/validation failures in the PWA.
      cache: 'no-store',
    };

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      throw new SokoNetworkError(
        'Kosa la mtandao: Huna intaneti kwa sasa. Unatumia hali ya nje ya mtandao (Offline).',
      );
    }

    let response: Response;
    try {
      response = await fetch(url, config);
    } catch (networkErr) {
      throw new SokoNetworkError(
        networkErr instanceof Error ? networkErr.message : 'Failed to reach SokoKuu API',
      );
    }

    if (response.status === 401 && requiresAuth) {
      if (isRefreshing) {
        const nextToken = await new Promise<string>((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        });
        headers.set('Authorization', `Bearer ${nextToken}`);
        try {
          const retryRes = await fetch(url, { ...config, headers });
          return await parseResponseOrThrow<T>(retryRes);
        } catch (retryErr) {
          if (retryErr instanceof SokoHttpError) throw retryErr;
          throw new SokoNetworkError();
        }
      }

      isRefreshing = true;
      try {
        const newToken = await this.refreshAccessToken();
        isRefreshing = false;
        if (!newToken) {
          const expiredErr = new SokoHttpError(401, 'Session expired. Please sign in again.');
          processQueue(expiredErr, null);
          throw expiredErr;
        }
        processQueue(null, newToken);
        headers.set('Authorization', `Bearer ${newToken}`);
        try {
          response = await fetch(url, { ...config, headers });
        } catch (retryNetErr) {
          throw new SokoNetworkError(
            retryNetErr instanceof Error ? retryNetErr.message : 'Network retry failed',
          );
        }
      } catch (refreshErr) {
        isRefreshing = false;
        processQueue(refreshErr, null);
        throw refreshErr;
      }
    }

    return parseResponseOrThrow<T>(response);
  }

  static get<T = any>(endpoint: string, requiresAuth = true) {
    return this.request<T>(endpoint, { method: 'GET' }, requiresAuth);
  }

  static post<T = any>(
    endpoint: string,
    body?: any,
    requiresAuth = true,
    headers?: HeadersInit,
  ) {
    return this.request<T>(
      endpoint,
      {
        method: 'POST',
        body: body !== undefined ? JSON.stringify(body) : undefined,
        headers,
      },
      requiresAuth,
    );
  }

  static patch<T = any>(endpoint: string, body?: any, requiresAuth = true) {
    return this.request<T>(
      endpoint,
      {
        method: 'PATCH',
        body: body !== undefined ? JSON.stringify(body) : undefined,
      },
      requiresAuth,
    );
  }

  static delete<T = any>(endpoint: string, requiresAuth = true) {
    return this.request<T>(endpoint, { method: 'DELETE' }, requiresAuth);
  }

  static async downloadBlob(endpoint: string): Promise<Blob> {
    const baseUrl = getApiBaseUrl();
    const url = endpoint.startsWith('http')
      ? endpoint
      : `${baseUrl}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
    const headers = new Headers();
    const token = this.getAccessToken();
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
    let response: Response;
    try {
      response = await fetch(url, { method: 'GET', headers });
    } catch {
      throw new SokoNetworkError();
    }
    if (!response.ok) {
      throw new SokoHttpError(response.status, `Export failed (HTTP ${response.status})`);
    }
    return response.blob();
  }
}
