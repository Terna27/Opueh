export interface User {
  id: string;
  username: string;
  display_name: string;
  email: string;
  email_verified: boolean;
}
export interface Profile extends User {
  bio: string | null;
}
export interface Category {
  id: string;
  name: string;
  slug: string;
  description: string | null;
}
export interface AuthResult {
  user: User;
  access_token: string;
  refresh_token: string;
  expires_in: number;
}
export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
let session: AuthResult | null = null;
let revision = 0;
let refreshTask: Promise<void> | null = null;
export function setSession(value: AuthResult | null) {
  session = value;
  revision++;
  window.dispatchEvent(new Event("opueh-session"));
}
export function getSession() {
  return session;
}
const base = (import.meta.env.VITE_API_URL || "/api/v1").replace(/\/$/, "");
async function send<T>(
  path: string,
  init: RequestInit,
  token?: string,
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      ...init,
      headers,
      signal: init.signal ?? AbortSignal.timeout(15000),
    });
  } catch {
    throw new ApiError(
      0,
      "NETWORK_ERROR",
      "Unable to reach Opueh. Check your connection and try again.",
    );
  }
  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => null);
  if (!response.ok)
    throw new ApiError(
      response.status,
      data?.error?.code || "HTTP_ERROR",
      data?.error?.message || "The request could not be completed.",
    );
  if (!data)
    throw new ApiError(
      response.status,
      "INVALID_RESPONSE",
      "The server returned an unexpected response.",
    );
  return data as T;
}
async function refresh() {
  const expectedRevision = revision;
  const credential = session?.refresh_token;
  if (!credential)
    throw new ApiError(401, "UNAUTHENTICATED", "Please sign in again.");
  try {
    const next = await send<AuthResult>("/auth/refresh", {
      method: "POST",
      body: JSON.stringify({ refresh_token: credential }),
    });
    if (revision !== expectedRevision)
      throw new ApiError(
        401,
        "SESSION_CHANGED",
        "Your session changed. Please try again.",
      );
    setSession(next);
  } catch (error) {
    if (
      revision === expectedRevision &&
      error instanceof ApiError &&
      error.status === 401
    )
      setSession(null);
    throw error;
  }
}
export async function api<T>(
  path: string,
  init: RequestInit = {},
  authenticated = false,
): Promise<T> {
  const token = authenticated ? session?.access_token : undefined;
  if (authenticated && !token)
    throw new ApiError(401, "UNAUTHENTICATED", "Please sign in to continue.");
  try {
    return await send<T>(path, init, token);
  } catch (error) {
    if (!authenticated || !(error instanceof ApiError) || error.status !== 401)
      throw error;
    // Another request may already have rotated the access token.
    if (session?.access_token === token) {
      refreshTask ??= refresh().finally(() => {
        refreshTask = null;
      });
      await refreshTask;
    }
    if (!session)
      throw new ApiError(401, "UNAUTHENTICATED", "Please sign in again.");
    const retriedToken = session.access_token;
    try {
      return await send<T>(path, init, retriedToken);
    } catch (retryError) {
      if (
        retryError instanceof ApiError &&
        retryError.status === 401 &&
        session?.access_token === retriedToken
      )
        setSession(null);
      throw retryError;
    }
  }
}
export function json(method: string, value: unknown) {
  return { method, body: JSON.stringify(value) };
}
export function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";
}
