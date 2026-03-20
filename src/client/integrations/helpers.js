/**
 * Provider-agnostic integration data helpers.
 * Reads/writes integration metadata inside encrypted entry blobs.
 * Supports lazy migration from legacy `_plaid` to `integrations.plaid`.
 */

/**
 * Get integration metadata for a specific provider.
 * Backward-compatible: reads `integrations[type]` first, falls back to `_plaid` for legacy entries.
 */
export function getIntegration(data, type) {
  if (!data) return null;
  const fromNew = data.integrations?.[type];
  if (fromNew) return fromNew;
  // Legacy fallback
  if (type === 'plaid' && data._plaid) return data._plaid;
  return null;
}

/**
 * Get the integration type for an entry, or null if none.
 * Checks `integrations` keys first, falls back to `_plaid` detection.
 */
export function getIntegrationType(data) {
  if (!data) return null;
  const keys = Object.keys(data.integrations || {});
  if (keys.length > 0) return keys[0];
  if (data._plaid) return 'plaid';
  return null;
}

/**
 * Check if an entry has any integration.
 */
export function hasAnyIntegration(data) {
  return getIntegrationType(data) !== null;
}

/**
 * Set integration metadata on an entry. Returns a new object (immutable).
 * Always writes the new `integrations` format. Strips legacy `_plaid` if present.
 */
export function setIntegration(data, type, meta) {
  const result = { ...data };
  result.integrations = { ...(result.integrations || {}), [type]: meta };
  // Strip legacy field
  delete result._plaid;
  return result;
}

/**
 * Remove an integration from an entry. Returns a new object (immutable).
 */
export function removeIntegration(data, type) {
  const result = { ...data };
  if (result.integrations) {
    const { [type]: _, ...rest } = result.integrations;
    result.integrations = Object.keys(rest).length > 0 ? rest : undefined;
  }
  // Strip legacy field
  if (type === 'plaid') delete result._plaid;
  return result;
}

/**
 * Filter entries that have a specific integration type.
 */
export function getIntegrationEntries(entries, decryptedCache, type) {
  return entries.filter(e => {
    const d = decryptedCache[e.id];
    return d && getIntegration(d, type) !== null;
  });
}
