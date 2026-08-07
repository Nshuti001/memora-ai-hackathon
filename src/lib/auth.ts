/**
 * Client-side session handling.
 *
 * The token lives in localStorage rather than a cookie because the API is served from a different
 * origin (Lambda Function URL vs CloudFront), which rules out same-site cookies without extra
 * infrastructure. The trade is explicit: localStorage is readable by any script on the page, so the
 * app must not render untrusted HTML. In exchange the token is never sent automatically, so there is
 * no CSRF surface at all.
 */
const TOKEN_KEY = 'memora.token';
const USER_KEY = 'memora.user';

export interface AuthUser {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  createdAt: string;
}

const listeners = new Set<(user: AuthUser | null) => void>();

/** Subscribe to sign-in/sign-out. Returns an unsubscribe function. */
export function onAuthChange(fn: (user: AuthUser | null) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(user: AuthUser | null): void {
  for (const fn of listeners) fn(user);
}

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null; // Private browsing or storage disabled.
  }
}

export function getUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch {
    return null;
  }
}

function persist(token: string, user: AuthUser): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch {
    /* storage unavailable — the session simply won't survive a reload */
  }
  emit(user);
}

export function clearSession(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  } catch {
    /* ignore */
  }
  emit(null);
}

const BASE_URL =
  (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? 'http://localhost:8787';

async function post<T>(path: string, body: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...authHeader(),
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error(
      'Cannot reach the server. Start it with `cd server && npm run dev`, or check VITE_API_URL.',
    );
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error((payload as { error?: string }).error ?? `Request failed (${response.status})`);
  }
  return payload as T;
}

/** Header to attach to every authenticated API call. Empty when signed out. */
export function authHeader(): Record<string, string> {
  const token = getToken();
  return token ? { authorization: `Bearer ${token}` } : {};
}

interface AuthResponse {
  user: AuthUser;
  token: string;
  expiresAt: string;
}

export async function signUp(input: {
  name: string;
  email: string;
  password: string;
}): Promise<AuthUser> {
  const result = await post<AuthResponse>('/api/auth/signup', input);
  persist(result.token, result.user);
  return result.user;
}

export async function signIn(input: { email: string; password: string }): Promise<AuthUser> {
  const result = await post<AuthResponse>('/api/auth/login', input);
  persist(result.token, result.user);
  return result.user;
}

export async function signOut(): Promise<void> {
  // Revoke server-side first, but clear locally even if that call fails — a user who clicks sign out
  // must end up signed out, not stuck because the network blipped.
  try {
    await post('/api/auth/logout', {});
  } catch {
    /* ignore */
  }
  clearSession();
}

/**
 * Re-checks the stored token against the server.
 *
 * Called on load: the cached user object could be stale, and the session may have expired or been
 * revoked elsewhere. A 401 clears the local session so the UI never shows a signed-in state that
 * the API will reject.
 */
export async function refreshSession(): Promise<AuthUser | null> {
  if (!getToken()) return null;

  try {
    const response = await fetch(`${BASE_URL}/api/auth/me`, { headers: authHeader() });
    if (response.status === 401) {
      clearSession();
      return null;
    }
    if (!response.ok) return getUser();

    const { user } = (await response.json()) as { user: AuthUser };
    try {
      localStorage.setItem(USER_KEY, JSON.stringify(user));
    } catch {
      /* ignore */
    }
    emit(user);
    return user;
  } catch {
    // Server unreachable — keep the cached session rather than signing the user out spuriously.
    return getUser();
  }
}

/** First name, or the part of the email before the @, for compact display. */
export function displayName(user: AuthUser): string {
  const trimmed = user.name?.trim();
  if (trimmed) return trimmed.split(/\s+/)[0];
  return user.email.split('@')[0];
}

/** Up to two letters for the avatar circle. */
export function initials(user: AuthUser): string {
  const trimmed = user.name?.trim();
  if (trimmed) {
    const parts = trimmed.split(/\s+/).filter(Boolean);
    return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase();
  }
  return user.email.slice(0, 2).toUpperCase();
}
