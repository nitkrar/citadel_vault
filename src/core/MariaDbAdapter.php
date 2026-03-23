<?php
/**
 * Citadel Vault — MariaDB Storage Adapter
 *
 * Production storage backend using PDO prepared statements against the
 * MariaDB / MySQL schema defined in database/01-schema.sql.
 */
require_once __DIR__ . '/StorageAdapter.php';
require_once __DIR__ . '/../../config/database.php';

class MariaDbAdapter implements StorageAdapter {

    private const VALID_ENTRY_TYPES = ['password', 'account', 'asset', 'license', 'insurance', 'custom'];

    /**
     * Allowed columns for vault key upserts.
     */
    private const VAULT_KEY_COLUMNS = [
        'vault_key_salt', 'encrypted_dek', 'recovery_key_salt',
        'encrypted_dek_recovery', 'recovery_key_encrypted',
        'public_key', 'encrypted_private_key', 'must_reset_vault_key',
    ];

    private PDO $db;

    public function __construct() {
        $this->db = Database::getInstance();
    }

    // =========================================================================
    // Vault Entries
    // =========================================================================

    public function getEntries(int $userId, ?string $entryType = null): array {
        // Cleanup: probabilistic purge of soft-deleted entries older than 1 day (~5% of requests)
        if (rand(1, 20) === 1) {
            $this->purgeExpiredSoftDeletes($userId);
        }

        $sql = 'SELECT ve.id, ve.entry_type, ve.template_id, ve.schema_version,
                       ve.encrypted_data, ve.created_at, ve.updated_at,
                       et.template_key, et.name AS template_name, et.icon AS template_icon,
                       et.fields AS template_fields,
                       et.subtype AS template_subtype, et.is_liability AS template_is_liability
                FROM vault_entries ve
                LEFT JOIN entry_templates et ON ve.template_id = et.id
                WHERE ve.user_id = ? AND ve.deleted_at IS NULL';
        $params = [$userId];

        if ($entryType !== null) {
            $sql .= ' AND ve.entry_type = ?';
            $params[] = $entryType;
        }

        $sql .= ' ORDER BY ve.updated_at DESC';

        $stmt = $this->db->prepare($sql);
        $stmt->execute($params);
        $rows = $stmt->fetchAll();

        // Shape template data inline
        return array_map([$this, 'shapeEntryRow'], $rows);
    }

    public function getEntryCounts(int $userId): array {
        $stmt = $this->db->prepare(
            'SELECT entry_type, COUNT(*) AS cnt
             FROM vault_entries
             WHERE user_id = ? AND deleted_at IS NULL
             GROUP BY entry_type'
        );
        $stmt->execute([$userId]);
        $rows = $stmt->fetchAll();
        $counts = [];
        foreach ($rows as $row) {
            $counts[$row['entry_type']] = (int)$row['cnt'];
        }
        return $counts;
    }

    public function getEntry(int $userId, int $entryId): ?array {
        $stmt = $this->db->prepare(
            'SELECT ve.id, ve.entry_type, ve.template_id, ve.schema_version,
                    ve.encrypted_data, ve.created_at, ve.updated_at,
                    et.template_key, et.name AS template_name, et.icon AS template_icon,
                    et.fields AS template_fields,
                    et.subtype AS template_subtype, et.is_liability AS template_is_liability
             FROM vault_entries ve
             LEFT JOIN entry_templates et ON ve.template_id = et.id
             WHERE ve.id = ? AND ve.user_id = ? AND ve.deleted_at IS NULL'
        );
        $stmt->execute([$entryId, $userId]);
        $row = $stmt->fetch();
        return $row ? $this->shapeEntryRow($row) : null;
    }

    public function createEntry(int $userId, string $entryType, string $encryptedData, ?int $templateId = null, int $schemaVersion = 1): int {
        // Server-side entry_type validation
        if (!in_array($entryType, self::VALID_ENTRY_TYPES, true)) {
            throw new InvalidArgumentException(
                "Invalid entry type: '{$entryType}'. Allowed: " . implode(', ', self::VALID_ENTRY_TYPES)
            );
        }

        $stmt = $this->db->prepare(
            'INSERT INTO vault_entries (user_id, entry_type, template_id, schema_version, encrypted_data)
             VALUES (?, ?, ?, ?, ?)'
        );
        $stmt->execute([$userId, $entryType, $templateId, $schemaVersion, $encryptedData]);
        return (int)$this->db->lastInsertId();
    }

    public function updateEntry(int $userId, int $entryId, string $encryptedData, ?string $entryType = null, ?int $templateId = null): bool {
        // Enforce template_id immutability: reject if caller tries to change it
        if ($templateId !== null) {
            $stmt = $this->db->prepare(
                'SELECT template_id FROM vault_entries WHERE id = ? AND user_id = ? AND deleted_at IS NULL'
            );
            $stmt->execute([$entryId, $userId]);
            $existing = $stmt->fetch();
            if (!$existing) {
                return false; // entry not found
            }
            $existingTpl = $existing['template_id'] !== null ? (int)$existing['template_id'] : null;
            if ($existingTpl !== null && $existingTpl !== $templateId) {
                throw new InvalidArgumentException(
                    "template_id is immutable after creation. Cannot change from {$existingTpl} to {$templateId}."
                );
            }
        }

        $setClauses = ['encrypted_data = ?'];
        $params = [$encryptedData];

        if ($entryType !== null) {
            if (!in_array($entryType, self::VALID_ENTRY_TYPES, true)) {
                throw new InvalidArgumentException("Invalid entry type: '{$entryType}'.");
            }
            $setClauses[] = 'entry_type = ?';
            $params[] = $entryType;
        }
        if ($templateId !== null) {
            $setClauses[] = 'template_id = ?';
            $params[] = $templateId;
        }

        $params[] = $entryId;
        $params[] = $userId;

        $stmt = $this->db->prepare(
            'UPDATE vault_entries SET ' . implode(', ', $setClauses) . ' WHERE id = ? AND user_id = ? AND deleted_at IS NULL'
        );
        $stmt->execute($params);
        return $stmt->rowCount() > 0;
    }

    public function deleteEntry(int $userId, int $entryId): bool {
        // Soft delete: set deleted_at timestamp
        $stmt = $this->db->prepare(
            'UPDATE vault_entries SET deleted_at = NOW() WHERE id = ? AND user_id = ? AND deleted_at IS NULL'
        );
        $stmt->execute([$entryId, $userId]);
        return $stmt->rowCount() > 0;
    }

    // =========================================================================
    // User Vault Keys
    // =========================================================================

    public function getVaultKeys(int $userId): ?array {
        $stmt = $this->db->prepare(
            'SELECT vault_key_salt, encrypted_dek, recovery_key_salt,
                    encrypted_dek_recovery, recovery_key_encrypted,
                    public_key, encrypted_private_key, must_reset_vault_key
             FROM user_vault_keys WHERE user_id = ?'
        );
        $stmt->execute([$userId]);
        $row = $stmt->fetch();
        return $row ?: null;
    }

    public function setVaultKeys(int $userId, array $keyData): bool {
        // Filter to only allowed columns
        $filtered = array_intersect_key($keyData, array_flip(self::VAULT_KEY_COLUMNS));
        if (empty($filtered)) {
            return false;
        }

        // Check if row exists
        $stmt = $this->db->prepare('SELECT id FROM user_vault_keys WHERE user_id = ?');
        $stmt->execute([$userId]);
        $exists = $stmt->fetch();

        if ($exists) {
            // Update
            $setClauses = [];
            $params = [];
            foreach ($filtered as $col => $val) {
                $setClauses[] = "`{$col}` = ?";
                $params[] = $val;
            }
            $params[] = $userId;
            $sql = 'UPDATE user_vault_keys SET ' . implode(', ', $setClauses) . ' WHERE user_id = ?';
            $stmt = $this->db->prepare($sql);
            $stmt->execute($params);
        } else {
            // Insert
            $filtered['user_id'] = $userId;
            $cols = array_keys($filtered);
            $placeholders = array_fill(0, count($cols), '?');
            $sql = 'INSERT INTO user_vault_keys (`' . implode('`, `', $cols) . '`) VALUES (' . implode(', ', $placeholders) . ')';
            $stmt = $this->db->prepare($sql);
            $stmt->execute(array_values($filtered));
        }

        return true;
    }

    // =========================================================================
    // Preferences (KV Store)
    // =========================================================================

    public function getPreferences(int $userId): array {
        $stmt = $this->db->prepare(
            'SELECT setting_key, setting_value FROM user_preferences WHERE user_id = ?'
        );
        $stmt->execute([$userId]);
        $rows = $stmt->fetchAll();

        $prefs = [];
        foreach ($rows as $row) {
            $prefs[$row['setting_key']] = $row['setting_value'];
        }
        return $prefs;
    }

    public function setPreference(int $userId, string $key, string $value): bool {
        $stmt = $this->db->prepare(
            'INSERT INTO user_preferences (user_id, setting_key, setting_value)
             VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)'
        );
        $stmt->execute([$userId, $key, $value]);
        return true;
    }

    // =========================================================================
    // Sharing
    // =========================================================================

    public function getSharedByMe(int $userId): array {
        $stmt = $this->db->prepare(
            'SELECT si.id, si.recipient_identifier, si.recipient_id, si.source_entry_id,
                    si.entry_type, si.source_type, si.template_id, si.recipient_id,
                    si.sync_mode, si.label, si.expires_at,
                    si.created_at, si.updated_at,
                    u.username AS recipient_username,
                    et.template_key, et.name AS template_name, et.icon AS template_icon,
                    et.fields AS template_fields
             FROM shared_items si
             LEFT JOIN users u ON si.recipient_id = u.id
             LEFT JOIN entry_templates et ON si.template_id = et.id
             WHERE si.sender_id = ?
             ORDER BY si.created_at DESC'
        );
        $stmt->execute([$userId]);
        $rows = $stmt->fetchAll();

        return array_map(function ($row) {
            return [
                'id'                   => (int)$row['id'],
                'recipient_identifier' => $row['recipient_identifier'],
                'recipient_username'   => $row['recipient_username'],
                'source_entry_id'      => (int)$row['source_entry_id'],
                'entry_type'           => $row['entry_type'],
                'source_type'          => $row['source_type'] ?? 'entry',
                'recipient_id'         => $row['recipient_id'] !== null ? (int)$row['recipient_id'] : null,
                'status'               => ((int)$row['recipient_id'] === 0 || $row['recipient_id'] === null) ? 'pending' : 'active',
                'sync_mode'            => $row['sync_mode'] ?? 'snapshot',
                'label'                => $row['label'] ?? null,
                'expires_at'           => $row['expires_at'] ?? null,
                'template'             => $this->buildTemplateObject($row),
                'created_at'           => $row['created_at'],
                'updated_at'           => $row['updated_at'],
            ];
        }, $rows);
    }

    public function getSharedWithMe(int $userId): array {
        $stmt = $this->db->prepare(
            'SELECT si.id, si.sender_id, si.source_entry_id, si.entry_type, si.source_type,
                    si.template_id, si.encrypted_data, si.recipient_id,
                    si.sync_mode, si.label, si.expires_at,
                    si.created_at, si.updated_at,
                    u.username AS sender_username,
                    et.template_key, et.name AS template_name, et.icon AS template_icon,
                    et.fields AS template_fields
             FROM shared_items si
             LEFT JOIN users u ON si.sender_id = u.id
             LEFT JOIN entry_templates et ON si.template_id = et.id
             WHERE si.recipient_id = ?
               AND (si.expires_at IS NULL OR si.expires_at > NOW())
             ORDER BY si.created_at DESC'
        );
        $stmt->execute([$userId]);
        $rows = $stmt->fetchAll();

        return array_map(function ($row) {
            return [
                'id'               => (int)$row['id'],
                'source_entry_id'  => (int)$row['source_entry_id'],
                'sender_username'  => $row['sender_username'],
                'entry_type'       => $row['entry_type'],
                'source_type'      => $row['source_type'] ?? 'entry',
                'encrypted_data'   => $row['encrypted_data'],
                'status'           => ((int)$row['recipient_id'] === 0 || $row['recipient_id'] === null) ? 'pending' : 'active',
                'sync_mode'        => $row['sync_mode'] ?? 'snapshot',
                'label'            => $row['label'] ?? null,
                'expires_at'       => $row['expires_at'] ?? null,
                'template'         => $this->buildTemplateObject($row),
                'created_at'       => $row['created_at'],
                'updated_at'       => $row['updated_at'],
            ];
        }, $rows);
    }

    public function createShare(array $shareData): int {
        $stmt = $this->db->prepare(
            'INSERT INTO shared_items (sender_id, recipient_identifier, recipient_id, source_entry_id,
                                       entry_type, source_type, template_id, encrypted_data,
                                       sync_mode, label, expires_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        $stmt->execute([
            $shareData['sender_id'],
            $shareData['recipient_identifier'],
            $shareData['recipient_id'] ?? null,
            $shareData['source_entry_id'],
            $shareData['entry_type'],
            $shareData['source_type'] ?? 'entry',
            $shareData['template_id'] ?? null,
            $shareData['encrypted_data'],
            $shareData['sync_mode'] ?? 'snapshot',
            $shareData['label'] ?? null,
            $shareData['expires_at'] ?? null,
        ]);
        return (int)$this->db->lastInsertId();
    }

    public function upsertShare(array $shareData): int {
        $stmt = $this->db->prepare(
            'INSERT INTO shared_items (sender_id, recipient_identifier, recipient_id, source_entry_id,
                                       entry_type, source_type, template_id, encrypted_data,
                                       sync_mode, label, expires_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE encrypted_data = VALUES(encrypted_data),
                                      sync_mode = VALUES(sync_mode),
                                      source_type = VALUES(source_type),
                                      label = VALUES(label),
                                      expires_at = VALUES(expires_at),
                                      updated_at = CURRENT_TIMESTAMP'
        );
        $stmt->execute([
            $shareData['sender_id'],
            $shareData['recipient_identifier'],
            $shareData['recipient_id'] ?? null,
            $shareData['source_entry_id'],
            $shareData['entry_type'],
            $shareData['source_type'] ?? 'entry',
            $shareData['template_id'] ?? null,
            $shareData['encrypted_data'],
            $shareData['sync_mode'] ?? 'snapshot',
            $shareData['label'] ?? null,
            $shareData['expires_at'] ?? null,
        ]);
        // lastInsertId returns 0 on UPDATE — query for the existing ID
        $id = (int)$this->db->lastInsertId();
        if ($id === 0) {
            $stmt = $this->db->prepare(
                'SELECT id FROM shared_items WHERE sender_id = ? AND source_entry_id = ? AND recipient_id = ?'
            );
            $stmt->execute([$shareData['sender_id'], $shareData['source_entry_id'], $shareData['recipient_id']]);
            $row = $stmt->fetch();
            $id = $row ? (int)$row['id'] : 0;
        }
        return $id;
    }

    public function updateShare(int $shareId, string $encryptedData): bool {
        $stmt = $this->db->prepare(
            'UPDATE shared_items SET encrypted_data = ? WHERE id = ?'
        );
        $stmt->execute([$encryptedData, $shareId]);
        return $stmt->rowCount() > 0;
    }

    public function deleteShare(int $senderId, int $shareId): bool {
        // Ownership check: only the sender can revoke
        $stmt = $this->db->prepare(
            'DELETE FROM shared_items WHERE id = ? AND sender_id = ?'
        );
        $stmt->execute([$shareId, $senderId]);
        return $stmt->rowCount() > 0;
    }

    // =========================================================================
    // Snapshots
    // =========================================================================

    public function getSnapshots(int $userId, ?string $fromDate = null, ?string $toDate = null): array {
        $sql = 'SELECT id, snapshot_date, snapshot_time, encrypted_data
                FROM portfolio_snapshots
                WHERE user_id = ?';
        $params = [$userId];

        if ($fromDate !== null) {
            $sql .= ' AND snapshot_date >= ?';
            $params[] = $fromDate;
        }
        if ($toDate !== null) {
            $sql .= ' AND snapshot_date <= ?';
            $params[] = $toDate;
        }

        $sql .= ' ORDER BY snapshot_date ASC, snapshot_time ASC';

        $stmt = $this->db->prepare($sql);
        $stmt->execute($params);
        return $stmt->fetchAll();
    }

    public function createSnapshot(int $userId, string $date, string $encryptedData): int {
        // One snapshot per user per day — delete existing then insert
        $stmt = $this->db->prepare(
            'DELETE FROM portfolio_snapshots WHERE user_id = ? AND snapshot_date = ?'
        );
        $stmt->execute([$userId, $date]);

        $stmt = $this->db->prepare(
            'INSERT INTO portfolio_snapshots (user_id, snapshot_date, encrypted_data)
             VALUES (?, ?, ?)'
        );
        $stmt->execute([$userId, $date, $encryptedData]);
        return (int)$this->db->lastInsertId();
    }

    public function createSnapshotWithEntries(int $userId, string $date, string $encryptedMeta, array $entries): int {
        $this->db->beginTransaction();
        try {
            // One snapshot per user per day — delete existing (entries cascade)
            $stmt = $this->db->prepare(
                'DELETE FROM portfolio_snapshots WHERE user_id = ? AND snapshot_date = ?'
            );
            $stmt->execute([$userId, $date]);

            // Insert header row
            $stmt = $this->db->prepare(
                'INSERT INTO portfolio_snapshots (user_id, snapshot_date, encrypted_data)
                 VALUES (?, ?, ?)'
            );
            $stmt->execute([$userId, $date, $encryptedMeta]);
            $snapshotId = (int)$this->db->lastInsertId();

            // Batch insert entry rows
            if (!empty($entries)) {
                $stmt = $this->db->prepare(
                    'INSERT INTO portfolio_snapshot_entries (snapshot_id, entry_id, encrypted_data)
                     VALUES (?, ?, ?)'
                );
                foreach ($entries as $entry) {
                    $stmt->execute([
                        $snapshotId,
                        $entry['entry_id'] ?? null,
                        $entry['encrypted_data'],
                    ]);
                }
            }

            $this->db->commit();
            return $snapshotId;
        } catch (\Exception $e) {
            $this->db->rollBack();
            throw $e;
        }
    }

    public function getSnapshotsWithEntries(int $userId, ?string $fromDate = null, ?string $toDate = null): array {
        // Fetch snapshot headers
        $sql = 'SELECT id, snapshot_date, snapshot_time, encrypted_data
                FROM portfolio_snapshots
                WHERE user_id = ?';
        $params = [$userId];

        if ($fromDate !== null) {
            $sql .= ' AND snapshot_date >= ?';
            $params[] = $fromDate;
        }
        if ($toDate !== null) {
            $sql .= ' AND snapshot_date <= ?';
            $params[] = $toDate;
        }

        $sql .= ' ORDER BY snapshot_date ASC, snapshot_time ASC';

        $stmt = $this->db->prepare($sql);
        $stmt->execute($params);
        $snapshots = $stmt->fetchAll();

        if (empty($snapshots)) {
            return [];
        }

        // Collect snapshot IDs and build lookup
        $snapshotIds = array_column($snapshots, 'id');
        $indexed = [];
        foreach ($snapshots as &$s) {
            $s['entries'] = [];
            $indexed[(int)$s['id']] = &$s;
        }
        unset($s);

        // Fetch all entries for these snapshots in one query
        $placeholders = implode(',', array_fill(0, count($snapshotIds), '?'));
        $stmt = $this->db->prepare(
            "SELECT snapshot_id, entry_id, encrypted_data
             FROM portfolio_snapshot_entries
             WHERE snapshot_id IN ({$placeholders})
             ORDER BY id ASC"
        );
        $stmt->execute($snapshotIds);
        $entryRows = $stmt->fetchAll();

        foreach ($entryRows as $row) {
            $sid = (int)$row['snapshot_id'];
            if (isset($indexed[$sid])) {
                $indexed[$sid]['entries'][] = [
                    'entry_id'       => $row['entry_id'] !== null ? (int)$row['entry_id'] : null,
                    'encrypted_data' => $row['encrypted_data'],
                ];
            }
        }

        return $snapshots;
    }

    // =========================================================================
    // Audit Log
    // =========================================================================

    public function logAction(int $userId, string $action, ?string $resourceType = null, ?int $resourceId = null, ?string $ipHash = null): void {
        // Check user's audit_ip_mode preference — if 'none', discard the IP hash
        $prefs = $this->getPreferences($userId);
        $ipMode = $prefs['audit_ip_mode'] ?? 'hashed';
        if ($ipMode === 'none') {
            $ipHash = null;
        }

        $stmt = $this->db->prepare(
            'INSERT INTO audit_log (user_id, action, resource_type, resource_id, ip_hash)
             VALUES (?, ?, ?, ?, ?)'
        );
        $stmt->execute([$userId, $action, $resourceType, $resourceId, $ipHash]);
    }

    public function getAuditLog(int $userId, ?string $fromDate = null, ?string $toDate = null): array {
        $sql = 'SELECT id, action, resource_type, resource_id, created_at
                FROM audit_log
                WHERE user_id = ?';
        $params = [$userId];

        if ($fromDate !== null) {
            $sql .= ' AND created_at >= ?';
            $params[] = $fromDate;
        }
        if ($toDate !== null) {
            $sql .= ' AND created_at <= ?';
            $params[] = $toDate . ' 23:59:59';
        }

        $sql .= ' ORDER BY created_at DESC';

        $stmt = $this->db->prepare($sql);
        $stmt->execute($params);
        return $stmt->fetchAll();
    }

    // =========================================================================
    // Templates
    // =========================================================================

    public function getTemplates(int $userId): array {
        // Return global templates (owner_id IS NULL) and user's own custom templates
        $stmt = $this->db->prepare(
            'SELECT id, template_key, owner_id, name, icon, country_code, subtype, is_liability,
                    schema_version, fields, is_active, promotion_requested,
                    promotion_requested_at, created_at, updated_at
             FROM entry_templates
             WHERE (owner_id IS NULL OR owner_id = ?) AND is_active = 1
             ORDER BY template_key ASC, country_code ASC, subtype ASC'
        );
        $stmt->execute([$userId]);
        $rows = $stmt->fetchAll();

        // Decode the JSON fields column for each row
        return array_map(function ($row) {
            $row['fields'] = json_decode($row['fields'], true) ?? [];
            $row['is_global'] = $row['owner_id'] === null;
            return $row;
        }, $rows);
    }

    public function createTemplate(int $userId, array $templateData): int {
        $stmt = $this->db->prepare(
            'INSERT INTO entry_templates (template_key, owner_id, name, icon, country_code, subtype, schema_version, fields)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        );
        $stmt->execute([
            $templateData['template_key'],
            $userId,
            $templateData['name'],
            $templateData['icon'] ?? null,
            $templateData['country_code'] ?? null,
            $templateData['subtype'] ?? null,
            $templateData['schema_version'] ?? 1,
            is_string($templateData['fields']) ? $templateData['fields'] : json_encode($templateData['fields']),
        ]);
        return (int)$this->db->lastInsertId();
    }

    public function updateTemplate(int $userId, int $templateId, array $data): bool {
        // Only allow updating own templates (owner_id = userId)
        // Build dynamic SET clause from allowed fields
        $allowedFields = ['name', 'icon', 'fields', 'is_active', 'promotion_requested', 'promotion_requested_at'];
        $setClauses = [];
        $params = [];

        foreach ($data as $key => $value) {
            if (!in_array($key, $allowedFields, true)) {
                continue;
            }
            if ($key === 'fields' && !is_string($value)) {
                $value = json_encode($value);
            }
            $setClauses[] = "`{$key}` = ?";
            $params[] = $value;
        }

        if (empty($setClauses)) {
            return false;
        }

        $params[] = $templateId;
        $params[] = $userId;

        $sql = 'UPDATE entry_templates SET ' . implode(', ', $setClauses) . ' WHERE id = ? AND owner_id = ?';
        $stmt = $this->db->prepare($sql);
        $stmt->execute($params);
        return $stmt->rowCount() > 0;
    }

    // =========================================================================
    // System Settings (global KV store)
    // =========================================================================

    public function getSystemSetting(string $key): ?string {
        $stmt = $this->db->prepare(
            'SELECT setting_value FROM system_settings WHERE setting_key = ?'
        );
        $stmt->execute([$key]);
        $row = $stmt->fetch();
        return $row ? $row['setting_value'] : null;
    }

    public function getSystemSettings(): array {
        $stmt = $this->db->query('SELECT setting_key, setting_value FROM system_settings');
        $rows = $stmt->fetchAll();

        $settings = [];
        foreach ($rows as $row) {
            $settings[$row['setting_key']] = $row['setting_value'];
        }
        return $settings;
    }

    public function getSystemSettingsEnriched(): array {
        $stmt = $this->db->query(
            'SELECT setting_key, setting_value, type, category, description, options
             FROM system_settings
             ORDER BY category, type DESC, setting_key'
        );
        $rows = $stmt->fetchAll();
        $settings = [];
        foreach ($rows as $row) {
            $settings[$row['setting_key']] = [
                'value'       => $row['setting_value'],
                'type'        => $row['type'],
                'category'    => $row['category'],
                'description' => $row['description'],
                'options'     => $row['options'] ? json_decode($row['options'], true) : null,
            ];
        }
        return $settings;
    }

    public function setSystemSetting(string $key, string $value, ?int $userId = null): bool {
        $stmt = $this->db->prepare(
            'INSERT INTO system_settings (setting_key, setting_value, created_by, updated_by)
             VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by)'
        );
        $stmt->execute([$key, $value, $userId, $userId]);
        return true;
    }

    // =========================================================================
    // Private Helpers
    // =========================================================================

    /**
     * Permanently delete soft-deleted entries older than 1 day for a given user.
     */
    private function purgeExpiredSoftDeletes(int $userId): void {
        $stmt = $this->db->prepare(
            'DELETE FROM vault_entries
             WHERE user_id = ? AND deleted_at IS NOT NULL AND deleted_at < NOW() - INTERVAL 1 DAY'
        );
        $stmt->execute([$userId]);
    }

    /**
     * Shape a raw entry row into the API response format with inline template.
     */
    private function shapeEntryRow(array $row): array {
        return [
            'id'             => (int)$row['id'],
            'entry_type'     => $row['entry_type'],
            'template_id'    => $row['template_id'] ? (int)$row['template_id'] : null,
            'schema_version' => (int)$row['schema_version'],
            'encrypted_data' => $row['encrypted_data'],
            'template'       => $this->buildTemplateObject($row),
            'created_at'     => $row['created_at'],
            'updated_at'     => $row['updated_at'],
        ];
    }

    /**
     * Build a template sub-object from a JOINed row.
     * Returns null if no template was joined.
     */
    private function buildTemplateObject(array $row): ?array {
        if (empty($row['template_name'])) {
            return null;
        }
        return [
            'name'         => $row['template_name'],
            'icon'         => $row['template_icon'] ?? null,
            'key'          => $row['template_key'] ?? null,
            'subtype'      => $row['template_subtype'] ?? null,
            'is_liability' => isset($row['template_is_liability']) ? (bool)(int)$row['template_is_liability'] : false,
            'fields'       => isset($row['template_fields']) ? (json_decode($row['template_fields'], true) ?? []) : [],
        ];
    }
}
