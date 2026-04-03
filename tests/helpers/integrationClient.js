/**
 * Integration test API client — fully isolated from dev environment.
 * Points to test server on port 8082. Creates users on demand.
 * No dependency on seed data.
 */

const BASE_URL = 'http://localhost:8082/src/api';

/**
 * Register a new user (self-registration enabled in .env.test).
 * Returns { username, password, token }.
 */
async function createTestUser(username, password) {
  // Register
  const regResp = await fetch(`${BASE_URL}/auth.php?action=register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username,
      email: `${username}@test.local`,
      password,
    }),
  });
  if (!regResp.ok) {
    const body = await regResp.json().catch(() => ({}));
    throw new Error(`Registration failed for ${username}: ${regResp.status} ${body.error || ''}`);
  }

  // Login to get token
  const token = await login(username, password);
  return { username, password, token };
}

/**
 * Login and return auth token.
 */
async function login(username, password) {
  const resp = await fetch(`${BASE_URL}/auth.php?action=login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!resp.ok) throw new Error(`Login failed for ${username}: ${resp.status}`);

  // Extract token from cookie or body
  const setCookie = resp.headers.get('set-cookie') || '';
  const match = setCookie.match(/pv_auth=([^;]+)/);
  if (match) return match[1];

  const body = await resp.json();
  return body?.data?.token || body?.token;
}

/**
 * Make an authenticated API request.
 */
async function apiRequest(method, path, { json, token } = {}) {
  const url = `${BASE_URL}${path}`;
  const resp = await fetch(url, {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      ...(json ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(json ? { body: JSON.stringify(json) } : {}),
  });
  return resp;
}

/**
 * Extract data from API response envelope.
 */
async function extractData(resp) {
  const body = await resp.json();
  return body?.data ?? body;
}

export { BASE_URL, createTestUser, login, apiRequest, extractData };
