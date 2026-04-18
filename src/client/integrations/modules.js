/**
 * Integration provider registry.
 * Import available providers here. Adding/removing a provider = one line change.
 */
const providers = {};

/** Get a provider module by ID. Returns null if not found. */
export function getProvider(id) {
  return providers[id] ?? null;
}

/** Get all available provider modules. */
export function getAvailableProviders() {
  return Object.values(providers);
}

/** Get display info for a specific provider + its metadata. */
export function getProviderDisplayInfo(id, meta) {
  return providers[id]?.getDisplayInfo(meta) ?? null;
}
