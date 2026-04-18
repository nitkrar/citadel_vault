import { describe, expect, it } from 'vitest';
import { getAvailableProviders, getProvider, getProviderDisplayInfo } from '../../src/client/integrations/modules.js';

describe('integration provider registry', () => {
  it('returns null for unknown providers', () => {
    expect(getProvider('bank_sync')).toBeNull();
  });

  it('returns an empty list when no providers are registered', () => {
    expect(getAvailableProviders()).toEqual([]);
  });

  it('returns null display info when no provider is registered', () => {
    expect(getProviderDisplayInfo('bank_sync', { status: 'connected' })).toBeNull();
  });
});
