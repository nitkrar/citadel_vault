/**
 * JS API test client — replaces Python conftest.py ApiClient.
 * Used by tests in tests/api-js/.
 */

const BASE_URL = process.env.TEST_API_URL || 'http://localhost:8081/src/api';

const TEST_USERS = {
  admin: { username: 'initial_user', password: 'TestAdmin123' },
  regular: { username: 'test_regular_user', password: 'TestRegular1' },
};

/**
 * Ensure the regular test user exists.
 * The user is pre-seeded by _seed_test_data.php (no lazy creation needed).
 * This guard just prevents redundant login verification.
 */
let regularUserEnsured = false;
async function ensureRegularUser() {
  if (regularUserEnsured) return;
  regularUserEnsured = true;
}

let cachedTokens = {};

/**
 * Login and cache the auth token (session-scoped equivalent).
 */
async function getToken(role = 'admin') {
  if (cachedTokens[role]) return cachedTokens[role];

  // Ensure regular user exists before first login attempt
  if (role === 'regular') await ensureRegularUser();

  const creds = TEST_USERS[role];
  if (!creds) throw new Error(`Unknown test role: ${role}`);

  const resp = await fetch(`${BASE_URL}/auth.php?action=login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(creds),
  });

  if (!resp.ok) throw new Error(`Login failed for ${role}: ${resp.status}`);

  // Extract token from Set-Cookie header
  let token = null;
  const setCookie = resp.headers.get('set-cookie') || '';
  const match = setCookie.match(/pv_auth=([^;]+)/);
  if (match) token = match[1];

  // Fallback: token in response body (dev mode)
  if (!token) {
    const body = await resp.json();
    token = body?.data?.token || body?.token;
  }

  if (!token) throw new Error(`No token for ${role}`);
  cachedTokens[role] = token;
  return token;
}

/**
 * Make an authenticated API request.
 */
async function apiRequest(method, path, { json, params, token, role = 'admin' } = {}) {
  const authToken = token || await getToken(role);
  let url = `${BASE_URL}${path}`;

  if (params) {
    const qs = new URLSearchParams(params).toString();
    url += (url.includes('?') ? '&' : '?') + qs;
  }

  const opts = {
    method,
    headers: {
      'Authorization': `Bearer ${authToken}`,
      ...(json ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(json ? { body: JSON.stringify(json) } : {}),
  };

  return fetch(url, opts);
}

/**
 * Extract data from standard API response envelope.
 */
async function extractData(resp) {
  const body = await resp.json();
  return body?.data ?? body;
}

/**
 * Make an unauthenticated API request with an invalid token (for testing 401 enforcement).
 */
async function unauthRequest(method, path, { json, params } = {}) {
  let url = `${BASE_URL}${path}`;
  if (params) {
    const qs = new URLSearchParams(params).toString();
    url += (url.includes('?') ? '&' : '?') + qs;
  }
  return fetch(url, {
    method,
    headers: {
      'Authorization': 'Bearer invalid-token-for-testing',
      ...(json ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(json ? { body: JSON.stringify(json) } : {}),
  });
}

/**
 * Make a request with NO Authorization header at all (for testing missing-header 401).
 */
async function noAuthRequest(method, path, { json, params } = {}) {
  let url = `${BASE_URL}${path}`;
  if (params) {
    const qs = new URLSearchParams(params).toString();
    url += (url.includes('?') ? '&' : '?') + qs;
  }
  return fetch(url, {
    method,
    headers: {
      ...(json ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(json ? { body: JSON.stringify(json) } : {}),
  });
}

/** Reset cached tokens (call in afterAll if needed). */
function resetTokens() { cachedTokens = {}; }

export {
  BASE_URL, TEST_USERS, getToken,
  apiRequest, extractData, unauthRequest, noAuthRequest, resetTokens,
};

// Convenience shortcuts
export const api = {
  get: (path, opts) => apiRequest('GET', path, opts),
  post: (path, opts) => apiRequest('POST', path, opts),
  put: (path, opts) => apiRequest('PUT', path, opts),
  delete: (path, opts) => apiRequest('DELETE', path, opts),
  data: extractData,
};
