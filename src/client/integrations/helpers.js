/**
 * Provider-agnostic integration data helpers.
 * Reads/writes integration metadata inside encrypted entry blobs.
 */

/**
 * Get integration metadata for a specific provider.
 */
export function getIntegration(data, type) {
  if (!data) return null;
  return data.integrations?.[type] ?? null;
}

/**
 * Get the integration type for an entry, or null if none.
 */
export function getIntegrationType(data) {
  if (!data) return null;
  const keys = Object.keys(data.integrations || {});
  if (keys.length > 0) return keys[0];
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
 */
export function setIntegration(data, type, meta) {
  const result = { ...data };
  result.integrations = { ...(result.integrations || {}), [type]: meta };
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
