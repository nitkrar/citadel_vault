/**
 * Shared test data factories.
 * Reduces duplication across test files.
 */

/** Minimal valid vault entry shape. */
export function makeEntry(overrides = {}) {
  return {
    id: 1,
    user_id: 1,
    entry_type: 'password',
    template_id: 1,
    encrypted_data: 'base64-encrypted-blob',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    deleted_at: null,
    ...overrides,
  };
}

/** Template fields for a password entry. */
export function makePasswordFields() {
  return [
    { key: 'title', label: 'Title', type: 'text', required: true },
    { key: 'url', label: 'URL', type: 'url', required: false },
    { key: 'username', label: 'Username', type: 'text', required: false },
    { key: 'password', label: 'Password', type: 'secret', required: false },
    { key: 'notes', label: 'Notes', type: 'textarea', required: false },
  ];
}

/** Template object. */
export function makeTemplate(overrides = {}) {
  return {
    id: 1,
    name: 'Password',
    icon: 'key',
    template_key: 'password',
    entry_type: 'password',
    subtype: null,
    is_liability: 0,
    fields: JSON.stringify(makePasswordFields()),
    ...overrides,
  };
}

/**
 * Valid RSA-2048 OAEP public key in base64 SPKI format.
 * Pre-generated for deterministic tests — NOT a secret.
 */
export const TEST_RSA_PUBLIC_KEY =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAyiHQSNRd6GX7PYAI2T0E' +
  'Q5RvTC18LqTxKmMPqDPKOZkv9aYXtedqLmxHcWAWrJCTM4brT1bg+rkA0sKvImX8' +
  '5zt2KlSPJHvHpaLHnrrSCfnntaQGNisS9fZrbWfYlTv11DhuIzBX0hJ31XCaSnXX' +
  'DEMFFdSXZW3q8eWkuRgMnb8gk8JJsW2sqgPFpFfV/+/fB5giy5Q6mEu1ZWzntph' +
  'YKhbAVVPycpndyGeonlRdOu9N/riICBqTtTKyniPnZYpmLc1BcB5sVhHk4oNGK2D' +
  'NGdsyGRsPvePEAkSlZ/I+vHZz1T/Zh3v03wX5RFGKRFHVtaGRDI8aNJGpCWz4vAY' +
  'WlwIDAQAB';

/** Snapshot v3 payload. */
export function makeSnapshotPayload(overrides = {}) {
  return {
    snapshot_date: new Date().toISOString().slice(0, 10),
    meta: { total_value: 10000, currency: 'GBP', entry_count: 5 },
    entries: [
      { entry_id: 1, template_id: 1, entry_type: 'asset', value: 5000, currency: 'GBP' },
      { entry_id: 2, template_id: 2, entry_type: 'asset', value: 5000, currency: 'GBP' },
    ],
    ...overrides,
  };
}
