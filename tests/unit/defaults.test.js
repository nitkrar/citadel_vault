/**
 * Defaults & getUserPreference Tests
 */
import { describe, it, expect } from 'vitest';
import { PREFERENCE_DEFAULTS, getUserPreference } from '../../src/client/lib/defaults.js';

describe('PREFERENCE_DEFAULTS', () => {
  it('includes sync_interval defaulting to 3600', () => {
    expect(PREFERENCE_DEFAULTS.sync_interval).toBe('3600');
  });
});

describe('getUserPreference', () => {
  it('returns user value when present', () => {
    expect(getUserPreference({ sync_interval: '900' }, 'sync_interval')).toBe('900');
  });

  it('falls back to default when key missing', () => {
    expect(getUserPreference({}, 'sync_interval')).toBe('3600');
  });

  it('returns undefined for unknown keys with no default', () => {
    expect(getUserPreference({}, 'nonexistent_key')).toBeUndefined();
  });

  it('respects explicit falsy user values', () => {
    expect(getUserPreference({ sync_interval: '0' }, 'sync_interval')).toBe('0');
  });
});
