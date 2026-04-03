/**
 * Smoke test — verifies the integration test infrastructure works.
 * Creates a user, logs in, and confirms auth token works.
 */
import { describe, it, expect } from 'vitest';
import { createTestUser, apiRequest, extractData } from '../helpers/integrationClient.js';

describe('Integration test infrastructure', () => {
  let user;

  it('can register a new user', async () => {
    user = await createTestUser('smoke_test_user', 'SmokeTest#1');
    expect(user.token).toBeTruthy();
    expect(user.username).toBe('smoke_test_user');
  });

  it('auth token works for authenticated endpoints', async () => {
    const resp = await apiRequest('GET', '/auth.php?action=me', { token: user.token });
    expect(resp.status).toBe(200);
    const data = await extractData(resp);
    expect(data.username).toBe('smoke_test_user');
  });

  it('test DB is isolated (no seed users)', async () => {
    // initial_user should NOT exist in the test DB
    const resp = await fetch('http://localhost:8082/src/api/auth.php?action=login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'initial_user', password: 'Initial#12$' }),
    });
    expect(resp.status).toBe(401);
  });
});
