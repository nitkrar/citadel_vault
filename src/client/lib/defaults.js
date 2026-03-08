export const PREFERENCE_DEFAULTS = {
    vault_key_type: 'alphanumeric',
    auto_lock_mode: 'session',
    auto_lock_timeout: '3600',
    audit_ip_mode: 'hashed',
    vault_persist_session: 'lock_on_refresh',
};

export const VAULT_KEY_MINIMUMS = {
    numeric: 6,
    alphanumeric: 8,
    passphrase: 16,
};

export const VALID_ENTRY_TYPES = [
    'password', 'account', 'asset', 'license', 'insurance', 'custom'
];

export function getUserPreference(prefs, key) {
    return prefs[key] ?? PREFERENCE_DEFAULTS[key];
}

export function getVaultKeyMinLength(keyType) {
    return VAULT_KEY_MINIMUMS[keyType] || 8;
}
