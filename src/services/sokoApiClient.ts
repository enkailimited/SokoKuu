/**
 * SokoKuu TZ — Centralized Typed API Client
 * Handles Bearer token injection, transparent 401 refresh rotation with single-flight mutex,
 * automatic X-Idempotency-Key generation, and offline fallback mode.
 */

const getApiBaseUrl = (): string => {
  return (import.meta.env.VITE_API_BASE_URL as string) || '/api/v1';
};

let isRefreshing = false;
let failedQueue: Array<{
  resolve: (token: string) => void;
  reject: (err: any) => void;
}> = [];

const processQueue = (error: any, token: string | null = null) => {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token!);
    }
  });
  failedQueue = [];
};

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
    const url = endpoint.startsWith('http') ? endpoint : `${baseUrl}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;

    const headers = new Headers(options.headers || {});
    headers.set('Content-Type', headers.get('Content-Type') || 'application/json');

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
    };

    try {
      let response = await fetch(url, config);

      if (response.status === 401 && requiresAuth) {
        const originalRequest = config;
        if (isRefreshing) {
          return new Promise((resolve, reject) => {
            failedQueue.push({
              resolve: (token: string) => {
                (originalRequest.headers as Headers).set('Authorization', `Bearer ${token}`);
                resolve(fetch(url, originalRequest).then((r) => r.json()));
              },
              reject: (err) => reject(err),
            });
          });
        }

        isRefreshing = true;
        try {
          const newToken = await this.refreshAccessToken();
          isRefreshing = false;
          if (!newToken) {
            processQueue(new Error('SESSION_EXPIRED'), null);
            throw new Error('Session expired. Please sign in again.');
          }
          processQueue(null, newToken);
          (originalRequest.headers as Headers).set('Authorization', `Bearer ${newToken}`);
          response = await fetch(url, originalRequest);
        } catch (refreshErr) {
          isRefreshing = false;
          processQueue(refreshErr, null);
          throw refreshErr;
        }
      }

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({ message: response.statusText }));
        const errorMessage = errorBody.message || errorBody.error || `HTTP error ${response.status}`;
        const err = new Error(Array.isArray(errorMessage) ? errorMessage.join(', ') : errorMessage);
        (err as any).status = response.status;
        (err as any).response = errorBody;
        throw err;
      }

      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        return (await response.json()) as T;
      }
      return (await response.text()) as unknown as T;
    } catch (error) {
      if (!navigator.onLine) {
        throw new Error('Kosa la mtandao: Huna intaneti kwa sasa. Unatumia hali ya nje ya mtandao (Offline).');
      }
      throw error;
    }
  }

  static get<T = any>(endpoint: string, requiresAuth = true) {
    return this.request<T>(endpoint, { method: 'GET' }, requiresAuth);
  }

  static post<T = any>(endpoint: string, body?: any, requiresAuth = true) {
    return this.request<T>(
      endpoint,
      {
        method: 'POST',
        body: body ? JSON.stringify(body) : undefined,
      },
      requiresAuth,
    );
  }

  static patch<T = any>(endpoint: string, body?: any, requiresAuth = true) {
    return this.request<T>(
      endpoint,
      {
        method: 'PATCH',
        body: body ? JSON.stringify(body) : undefined,
      },
      requiresAuth,
    );
  }

  static delete<T = any>(endpoint: string, requiresAuth = true) {
    return this.request<T>(endpoint, { method: 'DELETE' }, requiresAuth);
  }
}
