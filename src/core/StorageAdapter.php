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
    // Transaction Control
    // =========================================================================

    /**
     * Begin a database transaction.
     * All subsequent writes will be buffered until commit() or rollBack().
     * Uses the singleton PDO connection, so transactions apply to all adapter calls.
     */
    function beginTransaction(): void;

    /**
     * Commit the current transaction, making all buffered writes permanent.
     */
    function commit(): void;

    /**
     * Roll back the current transaction, discarding all buffered writes.
     */
    function rollBack(): void;

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

    /**
     * Get soft-deleted entries within the 1-day recovery window.
     * LEFT JOINs entry_templates for template metadata.
     * @param int $userId Owner user ID
     * @return array List of entry rows with template info
     */
    function getSoftDeletedEntries(int $userId): array;

    /**
     * Restore a soft-deleted entry (sets deleted_at = NULL). Ownership enforced.
     * Only restores entries that are currently soft-deleted.
     * @return bool True if restored, false if not found / not owned / not deleted
     */
    function restoreDeletedEntry(int $userId, int $entryId): bool;

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

    /**
     * Find a recipient by username or email, with their vault public key.
     * Excludes ghost users and inactive users.
     * @param string $identifier Username or email
     * @return array|null Row with id and public_key (public_key may be null), or null if not found
     */
    function getRecipientWithVaultKey(string $identifier): ?array;

    /**
     * Find a share by the composite key (sender, source_entry, recipient).
     * @return array|null Row with id, or null if not found
     */
    function getShareByKey(int $senderId, int $sourceEntryId, int $recipientId): ?array;

    /**
     * Get share IDs for revocation. Handles both entry-based and portfolio (NULL source_entry_id) shares.
     * When $recipientId is provided, filters to that specific recipient.
     * @param int         $senderId      Sender user ID
     * @param int|null    $sourceEntryId Source entry ID (null for portfolio shares)
     * @param string|null $sourceType    Source type (e.g., 'portfolio') for NULL-safe matching
     * @param int|null    $recipientId   Optional recipient filter
     * @return array List of rows with id
     */
    function getSharesForRevoke(int $senderId, ?int $sourceEntryId, ?string $sourceType, ?int $recipientId = null): array;

    /**
     * Count active shares for an entry by a specific sender.
     * @param int $senderId Sender user ID
     * @param int $entryId  Source entry ID
     * @return int Share count
     */
    function getShareCountForEntry(int $senderId, int $entryId): int;

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
     * Update encrypted_data on existing snapshot entries.
     * @param int   $userId     Owner user ID (for ownership check)
     * @param int   $snapshotId Snapshot to update
     * @param array $entries    Array of [entry_id => int, encrypted_data => string]
     * @return int Number of entries updated
     */
    function updateSnapshotEntries(int $userId, int $snapshotId, array $entries): int;

    /**
     * Get snapshots with per-entry data for a user.
     * @return array List of snapshots, each with 'entries' sub-array
     */
    function getSnapshotsWithEntries(int $userId, ?string $fromDate = null, ?string $toDate = null): array;

    /**
     * Get paginated snapshots with entries (cursor-based, newest first).
     * @return array { snapshots: [...], has_more: bool, next_cursor: ?string }
     */
    function getSnapshotsWithEntriesPaginated(int $userId, ?string $before = null, int $limit = 50): array;

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

    // =========================================================================
    // Templates Admin
    // =========================================================================

    /**
     * Update a global template (owner_id IS NULL). Admin-only.
     * Different from updateTemplate which filters by owner_id = $userId.
     * @param int   $templateId Template ID
     * @param array $data       Associative array of column => value pairs (name, icon, fields, is_active)
     * @return bool True if updated
     */
    function updateGlobalTemplate(int $templateId, array $data): bool;

    /**
     * Move entries from one template to another for a specific user.
     * @param int $userId        Owner user ID
     * @param int $oldTemplateId Source template ID
     * @param int $newTemplateId Target template ID
     * @return int Number of entries relinked
     */
    function relinkEntries(int $userId, int $oldTemplateId, int $newTemplateId): int;

    /**
     * Get the owner_id of a template (for ownership verification).
     * @param int $templateId Template ID
     * @return array|null Row with owner_id, or null if not found
     */
    function getTemplateOwner(int $templateId): ?array;

    /**
     * Mark a template as requesting promotion to global.
     * Sets promotion_requested = 1 and promotion_requested_at = NOW().
     * @param int $templateId Template ID
     */
    function setPromotionRequested(int $templateId): void;

    /**
     * Get a template that is pending promotion.
     * @param int $templateId Template ID
     * @return array|null Full template row if found and promotion_requested = 1, null otherwise
     */
    function getTemplateForPromotion(int $templateId): ?array;

    /**
     * Create a global template (owner_id = NULL). Used for admin promotion.
     * @param array $templateData Associative array with template_key, name, icon, country_code, subtype, schema_version, fields
     * @return int The new template ID
     */
    function createGlobalTemplate(array $templateData): int;

    /**
     * Clear the promotion request flag on a template.
     * Sets promotion_requested = 0 and promotion_requested_at = NULL.
     * @param int $templateId Template ID
     */
    function clearPromotionRequest(int $templateId): void;

    // =========================================================================
    // Account Types
    // =========================================================================

    /**
     * Get all account types, ordered by is_system DESC, name ASC.
     * @return array List of account type rows
     */
    function getAccountTypes(): array;

    /**
     * Create a new account type.
     * @param array $data Associative array with name, description, icon, created_by
     * @return int The new account type ID
     */
    function createAccountType(array $data): int;

    /**
     * Get a single account type by ID.
     * @param int $id Account type ID
     * @return array|null Account type row or null if not found
     */
    function getAccountType(int $id): ?array;

    /**
     * Update an account type's fields.
     * @param int   $id     Account type ID
     * @param array $fields Associative array of column => value pairs to update
     */
    function updateAccountType(int $id, array $fields): void;

    /**
     * Delete an account type by ID.
     * @param int $id Account type ID
     */
    function deleteAccountType(int $id): void;

    /**
     * Get the number of accounts using a given account type.
     * @param int $id Account type ID
     * @return int Usage count
     */
    function getAccountTypeUsageCount(int $id): int;

    // =========================================================================
    // Asset Types
    // =========================================================================

    /**
     * Get all asset types, ordered by is_system DESC, name ASC.
     * @return array List of asset type rows
     */
    function getAssetTypes(): array;

    /**
     * Create a new asset type.
     * @param array $data Associative array with name, category, json_schema, icon, created_by
     * @return int The new asset type ID
     */
    function createAssetType(array $data): int;

    /**
     * Get a single asset type by ID.
     * @param int $id Asset type ID
     * @return array|null Asset type row or null if not found
     */
    function getAssetType(int $id): ?array;

    /**
     * Update an asset type's fields.
     * @param int   $id     Asset type ID
     * @param array $fields Associative array of column => value pairs to update
     */
    function updateAssetType(int $id, array $fields): void;

    /**
     * Delete an asset type by ID.
     * @param int $id Asset type ID
     */
    function deleteAssetType(int $id): void;

    /**
     * Get the number of assets using a given asset type.
     * @param int $id Asset type ID
     * @return int Usage count
     */
    function getAssetTypeUsageCount(int $id): int;

    // =========================================================================
    // Countries
    // =========================================================================

    /**
     * Get all countries with optional currency JOIN.
     * @param bool $includeInactive If true, include inactive countries
     * @return array List of country rows with default_currency_code and default_currency_symbol
     */
    function getCountries(bool $includeInactive = false): array;

    /**
     * Create a new country.
     * @param array $data Associative array with name, code, flag_emoji, default_currency_id
     * @return int The new country ID
     */
    function createCountry(array $data): int;

    /**
     * Get a single country by ID.
     * @param int $id Country ID
     * @return array|null Country row or null if not found
     */
    function getCountry(int $id): ?array;

    /**
     * Update a country's fields.
     * @param int   $id     Country ID
     * @param array $fields Associative array of column => value pairs to update
     */
    function updateCountry(int $id, array $fields): void;

    /**
     * Delete a country by ID.
     * @param int $id Country ID
     */
    function deleteCountry(int $id): void;

    /**
     * Get the number of accounts using a given country.
     * @param int $id Country ID
     * @return int Usage count
     */
    function getCountryUsageCount(int $id): int;

    // =========================================================================
    // Currencies
    // =========================================================================

    /**
     * Get all currencies, optionally including inactive ones.
     * @param bool $includeInactive If true, include inactive currencies
     * @return array List of currency rows
     */
    function getCurrencies(bool $includeInactive = false): array;

    /**
     * Create a new currency.
     * @param array $data Associative array with name, code, symbol, is_active, exchange_rate_to_base
     * @return int The new currency ID
     */
    function createCurrency(array $data): int;

    /**
     * Get a single currency by ID.
     * @param int $id Currency ID
     * @return array|null Currency row or null if not found
     */
    function getCurrency(int $id): ?array;

    /**
     * Update a currency's fields.
     * @param int   $id     Currency ID
     * @param array $fields Associative array of column => value pairs to update
     */
    function updateCurrency(int $id, array $fields): void;

    // =========================================================================
    // Exchanges
    // =========================================================================

    /**
     * Get all exchanges with country name JOIN, ordered by country_code, display_order, name.
     * @return array List of exchange rows with country_name
     */
    function getExchanges(): array;

    /**
     * Create a new exchange.
     * @param array $data Associative array with country_code, name, suffix, display_order
     * @return int The new exchange ID
     */
    function createExchange(array $data): int;

    /**
     * Get a single exchange by ID.
     * @param int $id Exchange ID
     * @return array|null Exchange row or null if not found
     */
    function getExchange(int $id): ?array;

    /**
     * Update an exchange's fields.
     * @param int   $id     Exchange ID
     * @param array $fields Associative array of column => value pairs to update
     */
    function updateExchange(int $id, array $fields): void;

    /**
     * Delete an exchange by ID.
     * @param int $id Exchange ID
     * @return bool True if deleted, false if not found
     */
    function deleteExchange(int $id): bool;

    // =========================================================================
    // Historical Rates
    // =========================================================================

    /**
     * Get historical exchange rates for a given date.
     * @param string $date Date in YYYY-MM-DD format
     * @return array List of rows with code, rate_to_base, base_currency
     */
    function getHistoricalRates(string $date): array;

    // =========================================================================
    // Prices
    // =========================================================================

    /**
     * Get cached ticker prices within TTL window.
     * @param array $tickers List of ticker symbols to look up
     * @param int   $ttlSeconds Cache TTL in seconds
     * @return array List of rows with ticker, exchange, price, currency, name, fetched_at
     */
    function getCachedPrices(array $tickers, int $ttlSeconds): array;

    /**
     * Upsert a ticker price into the cache.
     * INSERT ON DUPLICATE KEY UPDATE on ticker.
     * @param string $ticker   Ticker symbol
     * @param string $exchange Exchange name
     * @param float  $price    Current price
     * @param string $currency Price currency code
     * @param string $name     Ticker display name
     */
    function upsertPrice(string $ticker, string $exchange, float $price, string $currency, string $name): void;

    /**
     * Add or update a price history entry for today.
     * INSERT ON DUPLICATE KEY UPDATE on (ticker, recorded_at).
     * @param string $ticker   Ticker symbol
     * @param string $exchange Exchange name
     * @param float  $price    Current price
     * @param string $currency Price currency code
     */
    function addPriceHistory(string $ticker, string $exchange, float $price, string $currency): void;

    /**
     * Get all cached ticker prices (admin view).
     * @return array List of all ticker_prices rows ordered by fetched_at DESC
     */
    function getAllCachedPrices(): array;

    /**
     * Get ticker symbols whose cached price is older than TTL.
     * @param int $ttlSeconds — max age in seconds
     * @return string[] — list of stale ticker symbols
     */
    function getStaleTickers(int $ttlSeconds): array;

    /**
     * Clear the entire ticker price cache (admin action).
     */
    function clearPriceCache(): void;

    // =========================================================================
    // Exchange Rates
    // =========================================================================

    /**
     * Get the most recent last_updated timestamp from the currencies table.
     * @return string|null The MAX(last_updated) value, or null if no currencies exist
     */
    function getLastCurrencyUpdate(): ?string;

    /**
     * Get all currencies (id and code) for exchange rate update.
     * @return array List of rows with id and code
     */
    function getAllCurrenciesForUpdate(): array;

    /**
     * Update the exchange rate for a specific currency.
     * @param int   $currencyId Currency ID
     * @param float $rate       New exchange rate to base currency
     */
    function updateExchangeRate(int $currencyId, float $rate): void;

    /**
     * Add or update a currency rate history entry for today.
     * Uses ON DUPLICATE KEY UPDATE on (currency_id, recorded_at).
     * @param int    $currencyId   Currency ID
     * @param float  $rate         Rate to base currency
     * @param string $baseCurrency Base currency code
     */
    function addCurrencyRateHistory(int $currencyId, float $rate, string $baseCurrency): void;

    // =========================================================================
    // Account Detail Templates
    // =========================================================================

    /**
     * Get personal + global account detail templates visible to a user.
     * @param int $userId User ID (returns user's own + all global templates)
     * @return array List of template rows
     */
    function getAccountDetailTemplates(int $userId): array;

    /**
     * Upsert an account detail template (personal or global).
     * Uses $data['scope'] to distinguish: 'global' = admin global template,
     * anything else = personal template with ON DUPLICATE KEY UPDATE.
     * @param int   $userId User ID (owner for personal, 0 for global)
     * @param array $data   Must contain account_type_id, subtype, country_id, field_keys, scope
     * @return int The template ID (new or existing)
     */
    function upsertAccountDetailTemplate(int $userId, array $data): int;

    /**
     * Get a single account detail template by ID (for ownership/admin check).
     * @param int $id Template ID
     * @return array|null Template row with id, user_id, is_global, or null if not found
     */
    function getAccountDetailTemplate(int $id): ?array;

    /**
     * Delete an account detail template by ID.
     * @param int $id Template ID
     */
    function deleteAccountDetailTemplate(int $id): void;

    // =========================================================================
    // User Management
    // =========================================================================

    /**
     * Get active users for sharing dropdowns (excludes the requesting user).
     * @param int $excludeUserId User ID to exclude from results
     * @return array List of rows with id and username, ordered by username
     */
    function getActiveUsersSimple(int $excludeUserId): array;

    /**
     * Get all users with vault key status (admin view).
     * LEFT JOINs user_vault_keys for has_vault_key and must_reset_vault_key.
     * @return array List of user rows with vault key status fields
     */
    function getAllUsersWithVaultKeyStatus(): array;

    /**
     * Create a new user (admin action). Sets must_reset_password = 1.
     * May throw PDOException code 23000 on duplicate username/email.
     * @param array $data Associative array with username, display_name, email, password_hash, role
     * @return int The new user ID
     */
    function createUserByAdmin(array $data): int;

    /**
     * Update a user's fields (dynamic SET clause with column whitelist).
     * May throw PDOException code 23000 on duplicate username/email.
     * @param int   $id     User ID
     * @param array $fields Associative array of column => value pairs (username, email, password_hash, role, is_active, must_reset_password)
     */
    function updateUser(int $id, array $fields): void;

    /**
     * Delete a user by ID.
     * @param int $id User ID
     * @return bool True if deleted, false if user not found
     */
    function deleteUser(int $id): bool;

    // =========================================================================
    // Dashboard
    // =========================================================================

    /**
     * Get count of items shared with a user (recipient's inbox count).
     * @param int $userId Recipient user ID
     * @return int Number of shared items
     */
    function getSharedWithMeCount(int $userId): int;

    /**
     * Get the most recent timestamp for a specific audit action by a user.
     * @param int    $userId User ID
     * @param string $action Action identifier (e.g., 'login', 'vault_unlock')
     * @return string|null The MAX(created_at) value, or null if no matching event
     */
    function getLastAuditEvent(int $userId, string $action): ?string;

    // =========================================================================
    // Sync
    // =========================================================================

    /**
     * Get the most recent updated_at timestamp from vault_entries for a user.
     * @param int $userId Owner user ID
     * @return string|null The MAX(updated_at) value, or null if no entries
     */
    function getMaxEntryUpdatedAt(int $userId): ?string;

    /**
     * Get the most recent updated_at timestamp from the countries table.
     * @return string|null The MAX(updated_at) value, or null if no countries
     */
    function getMaxCountryUpdatedAt(): ?string;

    /**
     * Get the most recent updated_at timestamp from entry_templates
     * visible to a user (global + user's own).
     * @param int $userId User ID (to include user's custom templates)
     * @return string|null The MAX(updated_at) value, or null if no templates
     */
    function getMaxTemplateUpdatedAt(int $userId): ?string;

    // =========================================================================
    // Invitations
    // =========================================================================

    /**
     * Check if an email is already registered in the users table.
     * @param string $email Email address to check
     * @return bool True if a user with this email exists
     */
    function checkEmailRegistered(string $email): bool;

    /**
     * Get an existing unused, unexpired invitation for an email.
     * @param string $email Email address
     * @return array|null Invitation row (id, token, expires_at) or null
     */
    function getExistingInvitation(string $email): ?array;

    /**
     * Create a new invitation.
     * @param array $data Associative array with token, email, invited_by, expires_at
     * @return int The new invitation ID
     */
    function createInvitation(array $data): int;

    /**
     * Validate an invite token. Returns invitation with inviter username via JOIN.
     * Includes i.id for use by markInvitationUsed.
     * @param string $token Invite token
     * @return array|null Invitation row (id, email, expires_at, used_at, invited_by_username) or null
     */
    function validateInviteToken(string $token): ?array;

    /**
     * Get invitations created by a specific user.
     * @param int $userId User ID of the inviter
     * @return array List of invitation rows
     */
    function getInvitationsByUser(int $userId): array;

    /**
     * Get all invitations with inviter username (admin view).
     * @return array List of invitation rows with invited_by_username
     */
    function getAllInvitations(): array;

    /**
     * Get a single invitation by ID (for revoke checks).
     * @param int $id Invitation ID
     * @return array|null Invitation row (id, invited_by, used_at) or null
     */
    function getInvitation(int $id): ?array;

    /**
     * Delete an invitation by ID (revoke).
     * @param int $id Invitation ID
     */
    function deleteInvitation(int $id): void;

    /**
     * Mark an invitation as used (set used_at = NOW()).
     * @param int $id Invitation ID
     */
    function markInvitationUsed(int $id): void;

    // =========================================================================
    // Invite Requests
    // =========================================================================

    /**
     * Check if an invite request already exists for an email.
     * @param string $email Email address
     * @return bool True if a request for this email exists
     */
    function checkExistingInviteRequest(string $email): bool;

    /**
     * Create a new invite request.
     * @param string      $email  Email address
     * @param string|null $name   Optional requester name
     * @param string      $ipHash Hashed IP address for audit
     * @return int The new invite request ID
     */
    function createInviteRequest(string $email, ?string $name, string $ipHash): int;

    /**
     * Check if there is an active (unused, unexpired) invitation for an email.
     * @param string $email Email address
     * @return bool True if an active invitation exists
     */
    function checkActiveInviteForEmail(string $email): bool;

    // =========================================================================
    // Maintenance
    // =========================================================================

    /**
     * Delete rate limit records older than 7 days.
     * @return int Number of deleted rows
     */
    function cleanupRateLimits(): int;

    /**
     * Delete rejected/ignored invite requests older than 30 days.
     * @return int Number of deleted rows
     */
    function cleanupInviteRequests(): int;

    /**
     * Delete high-volume operational audit log entries older than 30 days.
     * Targets: share_created, share_revoked, system_setting_changed.
     * @return int Number of deleted rows
     */
    function cleanupAuditLogOperational(): int;

    /**
     * Delete all audit log entries older than 90 days.
     * @return int Number of deleted rows
     */
    function cleanupAuditLogOld(): int;

    // =========================================================================
    // Auth — Users
    // =========================================================================

    /**
     * Get a user by ID.
     * @param int $id User ID
     * @return array|null User row (id, username, display_name, email, role, must_reset_password, created_at) or null
     */
    function getUserById(int $id): ?array;

    /**
     * Get a user by username or email.
     * @param string $usernameOrEmail Username or email to search
     * @return array|null User row (id, username, display_name, email, password_hash, role, is_active, must_reset_password) or null
     */
    function getUserByIdentifier(string $usernameOrEmail): ?array;

    /**
     * Get a user's active status, role, and must_reset_password flag.
     * @param int $userId User ID
     * @return array|null Row with is_active, role, must_reset_password, or null
     */
    function getUserActiveAndRole(int $userId): ?array;

    /**
     * Get email_verified status for a user.
     * @param int $userId User ID
     * @return bool|null True if verified, false if not, null if user not found
     */
    function getEmailVerifiedStatus(int $userId): ?bool;

    /**
     * Get a user by their email verification token (only unverified users).
     * @param string $token Email verification token
     * @return array|null Row with id and email_verify_expires, or null
     */
    function getUserByEmailVerifyToken(string $token): ?array;

    /**
     * Mark a user's email as verified and clear verification token/expiry.
     * @param int $userId User ID
     */
    function markEmailVerified(int $userId): void;

    /**
     * Get RSA key presence status for a user.
     * @param int $userId User ID
     * @return array Associative array with has_public_key and has_encrypted_private_key bools
     */
    function getUserRsaKeyStatus(int $userId): array;

    /**
     * Check if a username or email is already taken (optionally excluding a user).
     * @param string   $username      Username to check (empty string to skip)
     * @param string   $email         Email to check (empty string to skip)
     * @param int|null $excludeUserId Optional user ID to exclude from the check
     * @return bool True if a duplicate exists
     */
    function checkDuplicateUser(string $username, string $email, ?int $excludeUserId = null): bool;

    /**
     * Create a new user from self-registration.
     * @param array $data Associative array with username, email, password_hash, role, email_verified, email_verify_token, email_verify_expires
     * @return int The new user ID
     */
    function createUserFromRegistration(array $data): int;

    /**
     * Update a user's profile fields (username, display_name, email).
     * @param int   $userId User ID
     * @param array $fields Associative array of column => value pairs
     */
    function updateUserProfile(int $userId, array $fields): void;

    /**
     * Get the password hash for a user.
     * @param int $userId User ID
     * @return string|null Password hash or null if user not found
     */
    function getPasswordHash(int $userId): ?string;

    /**
     * Update a user's password hash (simple update, no lockout reset).
     * @param int    $userId User ID
     * @param string $hash   New bcrypt hash
     */
    function updateUserPassword(int $userId, string $hash): void;

    /**
     * Reset a user's password and clear all lockout state + force-change flag.
     * @param int    $userId User ID
     * @param string $hash   New bcrypt hash
     */
    function resetPasswordAndUnlock(int $userId, string $hash): void;

    /**
     * Get the must_reset_password flag for a user.
     * @param int $userId User ID
     * @return bool|null True if must reset, false if not, null if user not found
     */
    function getMustResetPassword(int $userId): ?bool;

    /**
     * Get count of active admins excluding a specific user.
     * @param int $excludeUserId User ID to exclude
     * @return int Number of active admins
     */
    function getAdminCount(int $excludeUserId): int;

    /**
     * Delete a user by ID (self-delete).
     * @param int $userId User ID
     * @return bool True if deleted
     */
    function deleteUserById(int $userId): bool;

    /**
     * Get a user with recovery material (LEFT JOIN user_vault_keys).
     * @param string $usernameOrEmail Username or email
     * @return array|null Row with id, is_active, recovery_key_salt, encrypted_dek_recovery, or null
     */
    function getUserWithRecoveryMaterial(string $usernameOrEmail): ?array;

    /**
     * Get a username by user ID.
     * @param int $userId User ID
     * @return string|null Username or null if not found
     */
    function getUsernameById(int $userId): ?string;

    // =========================================================================
    // Auth — Lockout & Rate Limiting
    // =========================================================================

    /**
     * Increment failed login attempts and set last_failed_login_at to NOW().
     * @param int $userId User ID
     */
    function incrementFailedLogin(int $userId): void;

    /**
     * Get failed login attempt count and email for a user.
     * @param int $userId User ID
     * @return array|null Row with failed_login_attempts and email, or null
     */
    function getFailedLoginInfo(int $userId): ?array;

    /**
     * Set or clear the must_reset_password flag on a user.
     * @param int  $userId User ID
     * @param bool $must   True to set, false to clear
     */
    function setUserMustResetPassword(int $userId, bool $must): void;

    /**
     * Set or clear the locked_until timestamp on a user.
     * @param int         $userId User ID
     * @param string|null $until  Datetime string or null to clear
     */
    function setUserLockedUntil(int $userId, ?string $until): void;

    /**
     * Reset all lockout counters for a user (failed_login_attempts, locked_until, last_failed_login_at).
     * @param int $userId User ID
     */
    function resetLoginLockout(int $userId): void;

    /**
     * Get the locked_until value for a user.
     * @param int $userId User ID
     * @return array|null Row with locked_until, or null
     */
    function getUserLockoutStatus(int $userId): ?array;

    /**
     * Get rate limit record for an action + identifier.
     * @param string $action     Action name
     * @param string $identifier Hashed identifier
     * @return array|null Row with attempts and window_start, or null
     */
    function getRateLimit(string $action, string $identifier): ?array;

    /**
     * Upsert a rate limit record (increment attempts or create new).
     * @param string $action     Action name
     * @param string $identifier Hashed identifier
     */
    function upsertRateLimit(string $action, string $identifier): void;

    /**
     * Delete a rate limit record for an action + identifier.
     * @param string $action     Action name
     * @param string $identifier Hashed identifier
     */
    function deleteRateLimit(string $action, string $identifier): void;

    /**
     * Delete all rate limit records with window_start older than the given window.
     * @param int $windowSeconds Time window in seconds (records older than 2x this are deleted)
     */
    function deleteExpiredRateLimits(int $windowSeconds): void;

    // =========================================================================
    // Auth — Password History
    // =========================================================================

    /**
     * Get recent password hashes from history for a user.
     * @param int $userId User ID
     * @param int $limit  Maximum number of entries to return
     * @return array List of rows with password_hash, ordered by created_at DESC
     */
    function getPasswordHistory(int $userId, int $limit): array;

    /**
     * Add a password hash to the history.
     * @param int    $userId User ID
     * @param string $hash   Password hash to store
     */
    function addPasswordHistory(int $userId, string $hash): void;

    /**
     * Prune password history, keeping only the most recent entries.
     * @param int $userId    User ID
     * @param int $keepCount Number of most recent entries to keep
     */
    function prunePasswordHistory(int $userId, int $keepCount): void;

    // =========================================================================
    // WebAuthn
    // =========================================================================

    /**
     * Create a WebAuthn challenge with 5-minute expiry.
     * @param int|null $userId   User ID (NULL for authentication challenges)
     * @param string   $challenge Base64URL-encoded challenge string
     * @param string   $type      Challenge type ('register' or 'authenticate')
     * @return int The new challenge row ID
     */
    function createWebAuthnChallenge(?int $userId, string $challenge, string $type): int;

    /**
     * Get a non-expired WebAuthn challenge by ID.
     * @param int $challengeId Challenge row ID
     * @return array|null Row with challenge, user_id, type, or null if not found/expired
     */
    function getWebAuthnChallenge(int $challengeId): ?array;

    /**
     * Delete a WebAuthn challenge (single-use cleanup).
     * @param int $challengeId Challenge row ID
     */
    function deleteWebAuthnChallenge(int $challengeId): void;

    /**
     * Get existing credential IDs for a user (for exclude list during registration).
     * @param int $userId User ID
     * @return array List of credential_id strings
     */
    function getExistingCredentialIds(int $userId): array;

    /**
     * Register a new WebAuthn credential for a user.
     * @param int    $userId       User ID
     * @param string $credentialId Base64URL-encoded credential ID
     * @param string $publicKey    PEM-encoded public key
     * @param int    $signCount    Initial sign count
     * @param string $transports   JSON-encoded transports array
     * @param string $name         Display name for the credential
     * @return int The new credential row ID
     */
    function registerWebAuthnCredential(int $userId, string $credentialId, string $publicKey, int $signCount, string $transports, string $name): int;

    /**
     * Get a WebAuthn credential for authentication, JOINed with user data.
     * @param string $credentialId Base64URL-encoded credential ID
     * @return array|null Row with user_id, public_key, sign_count, credential_id, id, username, email, role, is_active, or null
     */
    function getWebAuthnCredentialForAuth(string $credentialId): ?array;

    /**
     * Update sign count and last_used_at for a WebAuthn credential after successful auth.
     * @param string $credentialId Base64URL-encoded credential ID
     * @param int    $signCount    New sign count value
     */
    function updateWebAuthnCredentialUsage(string $credentialId, int $signCount): void;

    /**
     * List all WebAuthn credentials for a user, ordered by created_at DESC.
     * @param int $userId User ID
     * @return array List of credential rows (id, credential_id, name, transports, created_at, last_used_at)
     */
    function listWebAuthnCredentials(int $userId): array;

    /**
     * Check if a WebAuthn credential belongs to a user (ownership verification).
     * @param int $credentialId Credential row ID
     * @param int $userId       User ID
     * @return bool True if the credential belongs to the user
     */
    function getWebAuthnCredentialOwnership(int $credentialId, int $userId): bool;

    /**
     * Rename a WebAuthn credential. Ownership enforced via WHERE clause.
     * @param int    $credentialId Credential row ID
     * @param int    $userId       User ID
     * @param string $name         New display name
     */
    function renameWebAuthnCredential(int $credentialId, int $userId, string $name): void;

    /**
     * Delete a WebAuthn credential. Ownership enforced via WHERE clause.
     * @param int $credentialId Credential row ID
     * @param int $userId       User ID
     */
    function deleteWebAuthnCredential(int $credentialId, int $userId): void;

    // =========================================================================
    // Plaid
    // =========================================================================

    /**
     * Upsert a Plaid item. INSERT ON DUPLICATE KEY UPDATE on (user_id, item_id).
     * @param int    $userId               Owner user ID
     * @param string $itemId               Plaid item ID
     * @param string $encryptedAccessToken  Encrypted access token
     */
    function upsertPlaidItem(int $userId, string $itemId, string $encryptedAccessToken): void;

    /**
     * Get Plaid items by user and a list of item IDs.
     * @param int   $userId  Owner user ID
     * @param array $itemIds List of Plaid item IDs
     * @return array List of rows with item_id, access_token
     */
    function getPlaidItems(int $userId, array $itemIds): array;

    /**
     * Update the status of a Plaid item.
     * @param string $itemId Plaid item ID
     * @param int    $userId Owner user ID
     * @param string $status New status string
     */
    function updatePlaidItemStatus(string $itemId, int $userId, string $status): void;

    /**
     * Get a single Plaid item by user and item ID.
     * @param int    $userId Owner user ID
     * @param string $itemId Plaid item ID
     * @return array|null Row with access_token, or null if not found
     */
    function getPlaidItem(int $userId, string $itemId): ?array;

    /**
     * Delete a Plaid item by user and item ID.
     * @param int    $userId Owner user ID
     * @param string $itemId Plaid item ID
     */
    function deletePlaidItem(int $userId, string $itemId): void;

    /**
     * Get all Plaid items for a user, ordered by created_at DESC.
     * @param int $userId Owner user ID
     * @return array List of rows with item_id, status, created_at, updated_at
     */
    function getPlaidItemsByUser(int $userId): array;
}
