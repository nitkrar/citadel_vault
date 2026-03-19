<?php
/**
 * Citadel Vault — Storage Adapter Interface
 *
 * Defines the contract for all storage backends (MariaDB, InMemory, etc.).
 * Every data-access call in the application goes through this interface,
 * making the backend swappable without touching API or business logic.
 */
interface StorageAdapter {

    // =========================================================================
    // Vault Entries
    // =========================================================================

    /**
     * Get all non-deleted entries for a user.
     * @param int         $userId    Owner user ID
     * @param string|null $entryType Optional filter by entry type
     * @return array List of entry rows (id, entry_type, template_id, schema_version, encrypted_data, created_at, updated_at)
     */
    function getEntries(int $userId, ?string $entryType = null): array;

    /**
     * Get entry counts grouped by type (lightweight, no blobs).
     * @return array Associative array of entry_type => count
     */
    function getEntryCounts(int $userId): array;

    /**
     * Get a single entry by ID, only if owned by the given user.
     * @return array|null Entry row or null if not found / not owned
     */
    function getEntry(int $userId, int $entryId): ?array;

    /**
     * Create a new vault entry.
     * @param int         $userId        Owner user ID
     * @param string      $entryType     Must be in the allowed entry types list
     * @param string      $encryptedData Opaque encrypted blob
     * @param int|null    $templateId    Optional template reference
     * @param int         $schemaVersion Schema version (default 1)
     * @return int The new entry ID
     */
    function createEntry(int $userId, string $entryType, string $encryptedData, ?int $templateId = null, int $schemaVersion = 1): int;

    /**
     * Update an existing entry's encrypted data. Ownership enforced.
     * Optionally change entry_type and template_id.
     * @return bool True if updated, false if not found / not owned
     */
    function updateEntry(int $userId, int $entryId, string $encryptedData, ?string $entryType = null, ?int $templateId = null): bool;

    /**
     * Soft-delete an entry (sets deleted_at). Ownership enforced.
     * @return bool True if soft-deleted, false if not found / not owned
     */
    function deleteEntry(int $userId, int $entryId): bool;

    // =========================================================================
    // User Vault Keys
    // =========================================================================

    /**
     * Get vault key material for a user.
     * @return array|null Key row or null if not set up yet
     */
    function getVaultKeys(int $userId): ?array;

    /**
     * Create or update vault key material for a user (upsert).
     * @param int   $userId  User ID
     * @param array $keyData Associative array of column => value pairs
     * @return bool True on success
     */
    function setVaultKeys(int $userId, array $keyData): bool;

    // =========================================================================
    // Preferences (KV Store)
    // =========================================================================

    /**
     * Get all preferences for a user as key => value pairs.
     * @return array Associative array of setting_key => setting_value
     */
    function getPreferences(int $userId): array;

    /**
     * Set a single preference (upsert).
     * @return bool True on success
     */
    function setPreference(int $userId, string $key, string $value): bool;

    // =========================================================================
    // Sharing
    // =========================================================================

    /**
     * Get all items shared BY a user (sender's outbox).
     * @return array List of shared item rows
     */
    function getSharedByMe(int $userId): array;

    /**
     * Get all items shared WITH a user (recipient's inbox).
     * JOINs entry_templates for inline template data.
     * @return array List of shared item rows with template info
     */
    function getSharedWithMe(int $userId): array;

    /**
     * Create a new shared item.
     * @param array $shareData Associative array with required fields
     * @return int The new share ID
     */
    function createShare(array $shareData): int;

    /**
     * Upsert a shared item. If (sender, entry, recipient) already exists,
     * update the encrypted_data. Otherwise create a new row.
     * @param array $shareData Associative array with required fields
     * @return int The share ID (new or existing)
     */
    function upsertShare(array $shareData): int;

    /**
     * Update a shared item's encrypted data (on-edit re-share).
     * @return bool True if updated
     */
    function updateShare(int $shareId, string $encryptedData): bool;

    /**
     * Delete a shared item (revoke). Sender ownership enforced.
     * @return bool True if deleted
     */
    function deleteShare(int $senderId, int $shareId): bool;

    // =========================================================================
    // Snapshots
    // =========================================================================

    /**
     * Get portfolio snapshots for a user, optionally filtered by date range.
     * @return array List of snapshot rows
     */
    function getSnapshots(int $userId, ?string $fromDate = null, ?string $toDate = null): array;

    /**
     * Create a new portfolio snapshot.
     * @return int The new snapshot ID
     */
    function createSnapshot(int $userId, string $date, string $encryptedData): int;

    /**
     * Create a snapshot with per-entry rows (split model).
     * @param int    $userId        Owner user ID
     * @param string $date          Snapshot date (YYYY-MM-DD)
     * @param string $encryptedMeta Encrypted metadata blob (base_currency, date)
     * @param array  $entries       Array of [entry_id => int|null, encrypted_data => string]
     * @return int The new snapshot ID
     */
    function createSnapshotWithEntries(int $userId, string $date, string $encryptedMeta, array $entries): int;

    /**
     * Get snapshots with per-entry data for a user.
     * @return array List of snapshots, each with 'entries' sub-array
     */
    function getSnapshotsWithEntries(int $userId, ?string $fromDate = null, ?string $toDate = null): array;

    // =========================================================================
    // Audit Log
    // =========================================================================

    /**
     * Log a security action. Respects user's audit_ip_mode preference.
     * @param int         $userId       User performing the action
     * @param string      $action       Action identifier (e.g., 'login', 'vault_unlock')
     * @param string|null $resourceType Optional resource type (e.g., 'vault_entry')
     * @param int|null    $resourceId   Optional resource ID
     * @param string|null $ipHash       Pre-hashed IP (or null if user opted out)
     */
    function logAction(int $userId, string $action, ?string $resourceType = null, ?int $resourceId = null, ?string $ipHash = null): void;

    /**
     * Get audit log entries for a user, optionally filtered by date range.
     * @return array List of audit log rows
     */
    function getAuditLog(int $userId, ?string $fromDate = null, ?string $toDate = null): array;

    // =========================================================================
    // System Settings (global KV store)
    // =========================================================================

    /**
     * Get a single system setting by key.
     * @return string|null The setting value, or null if not found
     */
    function getSystemSetting(string $key): ?string;

    /**
     * Get all system settings as key => value pairs.
     * @return array Associative array of setting_key => setting_value
     */
    function getSystemSettings(): array;

    /**
     * Get all system settings with metadata (type, category, description, options).
     * @return array Associative array of setting_key => { value, type, category, description, options }
     */
    function getSystemSettingsEnriched(): array;

    /**
     * Set a system setting (upsert).
     * @param string   $key    Setting key
     * @param string   $value  Setting value
     * @param int|null $userId User ID performing the change (for audit trail)
     * @return bool True on success
     */
    function setSystemSetting(string $key, string $value, ?int $userId = null): bool;

    // =========================================================================
    // Templates
    // =========================================================================

    /**
     * Get all templates visible to a user (global + user's custom).
     * Filters: owner_id IS NULL OR owner_id = $userId
     * @return array List of template rows
     */
    function getTemplates(int $userId): array;

    /**
     * Create a custom template owned by the user.
     * @return int The new template ID
     */
    function createTemplate(int $userId, array $templateData): int;

    /**
     * Update a custom template. Ownership enforced (user can only edit own templates).
     * @return bool True if updated
     */
    function updateTemplate(int $userId, int $templateId, array $data): bool;
}
