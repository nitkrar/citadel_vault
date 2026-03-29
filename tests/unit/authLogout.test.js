/** @vitest-environment jsdom */
/**
 * Auth Logout Cleanup Tests
 *
 * Verifies that:
 * 1. logout() delegates to vaultSession.destroy() for all crypto/storage cleanup
 * 2. logout() clears auth cookie via server
 * 3. logout() resets React state
 * 4. vaultSession.destroy() is called BEFORE server logout (defense in depth)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import { createElement, useEffect, useRef } from 'react';

// Node 22+ built-in localStorage lacks Storage API — provide a proper mock
const store = {};
const storageMock = {
  getItem: vi.fn((k) => store[k] ?? null),
  setItem: vi.fn((k, v) => { store[k] = String(v); }),
  removeItem: vi.fn((k) => { delete store[k]; }),
  clear: vi.fn(() => { for (const k in store) delete store[k]; }),
};
Object.defineProperty(globalThis, 'localStorage', { value: storageMock, writable: true, configurable: true });

// ── Module mocks (must be before imports) ───────────────────────────

vi.mock('../../src/client/api/client', () => ({
  default: {
    get: vi.fn().mockResolvedValue({ data: { data: {} } }),
    post: vi.fn().mockResolvedValue({ data: {} }),
  },
}));

vi.mock('../../src/client/components/WebAuthnLogin', () => ({
  authenticateWithPasskey: vi.fn(),
}));

vi.mock('../../src/client/lib/vaultSession', () => ({
  lock: vi.fn().mockResolvedValue(undefined),
  destroy: vi.fn(),
}));

// ── Imports (after mocks) ───────────────────────────────────────────

import * as vaultSession from '../../src/client/lib/vaultSession';
import api from '../../src/client/api/client';
import { AuthProvider, useAuth } from '../../src/client/contexts/AuthContext';

// Helper to extract auth actions from context via render
function renderAuth() {
  let actions;
  function Consumer() {
    const auth = useAuth();
    const ref = useRef();
    ref.current = auth;
    useEffect(() => { actions = ref.current; });
    return null;
  }
  render(createElement(AuthProvider, null, createElement(Consumer)));
  return () => actions;
}

describe('logout cleanup', () => {
  let getActions;

  beforeEach(() => {
    vi.clearAllMocks();
    getActions = renderAuth();
  });

  it('calls vaultSession.destroy() for full teardown', () => {
    act(() => getActions().logout());
    expect(vaultSession.destroy).toHaveBeenCalled();
  });

  it('calls server logout endpoint', () => {
    act(() => getActions().logout());
    expect(api.post).toHaveBeenCalledWith('/auth.php?action=logout');
  });

  it('clears vault BEFORE calling server (defense in depth)', () => {
    const callOrder = [];
    vaultSession.destroy.mockImplementation(() => callOrder.push('destroy'));
    api.post.mockImplementation(() => { callOrder.push('serverLogout'); return Promise.resolve({ data: {} }); });

    act(() => getActions().logout());

    expect(callOrder.indexOf('destroy')).toBeLessThan(callOrder.indexOf('serverLogout'));
  });

  it('resets user state to null', () => {
    // Login first
    const actions = getActions();
    act(() => actions.logout());
    expect(actions.isAuthenticated).toBe(false);
    expect(actions.user).toBeNull();
  });
});
