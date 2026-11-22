let csrfTokenCache = '';

export async function ensureCsrfToken(): Promise<string> {
  if (csrfTokenCache) return csrfTokenCache;
  const res = await fetch('/api/auth/csrf', { credentials: 'include' });
  const data = (await res.json()) as { csrfToken: string };
  csrfTokenCache = data.csrfToken;
  return csrfTokenCache;
}

export async function apiRequest<T = any>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    isFormData?: boolean;
  } = {}
): Promise<T> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = {};

  if (method !== 'GET' && method !== 'HEAD') {
    headers['X-CSRF-Token'] = await ensureCsrfToken();
  }

  let body: BodyInit | undefined;
  if (options.body !== undefined) {
    if (options.isFormData && options.body instanceof FormData) {
      body = options.body;
    } else {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.body);
    }
  }

  const res = await fetch(path, {
    method,
    headers,
    body,
    credentials: 'include',
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error((data as any).message || (data as any).error || `HTTP ${res.status}`);
    (err as any).status = res.status;
    (err as any).data = data;
    throw err;
  }
  return data as T;
}
