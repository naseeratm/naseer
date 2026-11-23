/**
 * In-memory-only session token store for NASEER Enterprise RBAC.
 *
 * Security invariant: Tokens are NEVER written to localStorage, sessionStorage, or cookies.
 * Clearing the browser tab or signing out immediately drops the token from memory.
 */

let inMemoryBearerToken: string | null = null;

export function setEnterpriseAuthToken(token: string | null): void {
  inMemoryBearerToken = token && token.trim() ? token.trim() : null;
}

export function getEnterpriseAuthToken(): string | null {
  return inMemoryBearerToken;
}

export function withEnterpriseAuthHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...(extra || {}) };
  if (inMemoryBearerToken && !headers.Authorization && !headers.authorization) {
    headers.Authorization = `Bearer ${inMemoryBearerToken}`;
  }
  return headers;
}
