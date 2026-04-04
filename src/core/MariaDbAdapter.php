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
        'admin_action_message',
    ];

    private PDO $db;

    public function __construct() {
        $this->db = Database::getInstance();
    }

    // =========================================================================
    // Transaction Control
    // =========================================================================

    public function beginTransaction(): void {
        $this->db->beginTransaction();
    }

    public function commit(): void {
        $this->db->commit();
    }

    public function rollBack(): void {
        $this->db->rollBack();
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

    public function getSoftDeletedEntries(int $userId): array {
        $stmt = $this->db->prepare(
            "SELECT ve.id, ve.entry_type, ve.template_id, ve.encrypted_data, ve.deleted_at, ve.created_at, ve.updated_at,
                    et.name AS template_name, et.icon AS template_icon, et.fields AS template_fields
             FROM vault_entries ve
             LEFT JOIN entry_templates et ON ve.template_id = et.id
             WHERE ve.user_id = ? AND ve.deleted_at IS NOT NULL
               AND ve.deleted_at >= NOW() - INTERVAL 1 DAY
             ORDER BY ve.deleted_at DESC"
        );
        $stmt->execute([$userId]);
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    public function restoreDeletedEntry(int $userId, int $entryId): bool {
        $stmt = $this->db->prepare(
            "UPDATE vault_entries SET deleted_at = NULL WHERE id = ? AND user_id = ? AND deleted_at IS NOT NULL"
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
                    public_key, encrypted_private_key, must_reset_vault_key,
                    admin_action_message
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
                    si.entry_type, si.source_type, si.template_id,
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
        $sourceEntryId = $shareData['source_entry_id'] ?? null;
        $recipientId = $shareData['recipient_id'] ?? null;

        // NULL source_entry_id (portfolio shares): unique key won't dedup NULLs,
        // so check for existing share explicitly before inserting.
        if ($sourceEntryId === null) {
            $stmt = $this->db->prepare(
                "SELECT id FROM shared_items
                 WHERE sender_id = ? AND source_entry_id IS NULL AND source_type = ? AND recipient_id = ?"
            );
            $stmt->execute([$shareData['sender_id'], $shareData['source_type'] ?? 'entry', $recipientId]);
            $existing = $stmt->fetch();
            if ($existing) {
                $stmt = $this->db->prepare(
                    'UPDATE shared_items SET encrypted_data = ?, sync_mode = ?, source_type = ?,
                            label = ?, expires_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
                );
                $stmt->execute([
                    $shareData['encrypted_data'],
                    $shareData['sync_mode'] ?? 'snapshot',
                    $shareData['source_type'] ?? 'entry',
                    $shareData['label'] ?? null,
                    $shareData['expires_at'] ?? null,
                    (int)$existing['id'],
                ]);
                return (int)$existing['id'];
            }
            return $this->createShare($shareData);
        }

        // Non-null source_entry_id: rely on unique key for ON DUPLICATE KEY UPDATE
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
            $recipientId,
            $sourceEntryId,
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
            $stmt->execute([$shareData['sender_id'], $sourceEntryId, $recipientId]);
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

    public function getRecipientWithVaultKey(string $identifier): ?array {
        $stmt = $this->db->prepare(
            "SELECT u.id, uvk.public_key
             FROM users u
             LEFT JOIN user_vault_keys uvk ON u.id = uvk.user_id
             WHERE (u.username = ? OR u.email = ?) AND u.is_active = 1 AND u.role != 'ghost'"
        );
        $stmt->execute([$identifier, $identifier]);
        $row = $stmt->fetch();
        return $row ?: null;
    }

    public function getShareByKey(int $senderId, int $sourceEntryId, int $recipientId): ?array {
        $stmt = $this->db->prepare(
            "SELECT id FROM shared_items
             WHERE sender_id = ? AND source_entry_id = ? AND recipient_id = ?"
        );
        $stmt->execute([$senderId, $sourceEntryId, $recipientId]);
        $row = $stmt->fetch();
        return $row ?: null;
    }

    public function getSharesForRevoke(int $senderId, ?int $sourceEntryId, ?string $sourceType, ?int $recipientId = null): array {
        // Build WHERE clause for source matching (NULL-safe for portfolio)
        if ($sourceEntryId === null) {
            $sql = "SELECT id FROM shared_items WHERE sender_id = ? AND source_entry_id IS NULL AND source_type = ?";
            $params = [$senderId, $sourceType ?? 'portfolio'];
        } else {
            $sql = "SELECT id FROM shared_items WHERE sender_id = ? AND source_entry_id = ?";
            $params = [$senderId, $sourceEntryId];
        }

        if ($recipientId !== null) {
            $sql .= " AND recipient_id = ?";
            $params[] = $recipientId;
        }

        $stmt = $this->db->prepare($sql);
        $stmt->execute($params);
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    public function getShareCountForEntry(int $senderId, int $entryId): int {
        $stmt = $this->db->prepare(
            "SELECT COUNT(*) FROM shared_items WHERE source_entry_id = ? AND sender_id = ?"
        );
        $stmt->execute([$entryId, $senderId]);
        return (int)$stmt->fetchColumn();
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

    public function updateSnapshotEntries(int $userId, int $snapshotId, array $entries): int {
        // Verify snapshot belongs to user
        $stmt = $this->db->prepare('SELECT id FROM portfolio_snapshots WHERE id = ? AND user_id = ?');
        $stmt->execute([$snapshotId, $userId]);
        if (!$stmt->fetch()) {
            throw new \RuntimeException('Snapshot not found or access denied.');
        }

        $updated = 0;
        $stmt = $this->db->prepare(
            'UPDATE portfolio_snapshot_entries SET encrypted_data = ? WHERE snapshot_id = ? AND entry_id = ?'
        );
        foreach ($entries as $entry) {
            $stmt->execute([$entry['encrypted_data'], $snapshotId, $entry['entry_id']]);
            $updated += $stmt->rowCount();
        }
        return $updated;
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
    // Templates Admin
    // =========================================================================

    public function updateGlobalTemplate(int $templateId, array $data): bool {
        $allowed = ['name', 'icon', 'fields', 'is_active'];
        $fields = [];
        $values = [];
        foreach ($data as $k => $v) {
            if (in_array($k, $allowed, true)) { $fields[] = "`$k` = ?"; $values[] = $v; }
        }
        if (empty($fields)) {
            return false;
        }
        $values[] = $templateId;
        $stmt = $this->db->prepare("UPDATE entry_templates SET " . implode(', ', $fields) . " WHERE id = ? AND owner_id IS NULL");
        $stmt->execute($values);
        return $stmt->rowCount() > 0;
    }

    public function relinkEntries(int $userId, int $oldTemplateId, int $newTemplateId): int {
        $stmt = $this->db->prepare(
            "UPDATE vault_entries SET template_id = ? WHERE template_id = ? AND user_id = ?"
        );
        $stmt->execute([$newTemplateId, $oldTemplateId, $userId]);
        return $stmt->rowCount();
    }

    public function getTemplateOwner(int $templateId): ?array {
        $stmt = $this->db->prepare("SELECT owner_id FROM entry_templates WHERE id = ?");
        $stmt->execute([$templateId]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return $row ?: null;
    }

    public function setPromotionRequested(int $templateId): void {
        $stmt = $this->db->prepare(
            "UPDATE entry_templates SET promotion_requested = 1, promotion_requested_at = NOW() WHERE id = ?"
        );
        $stmt->execute([$templateId]);
    }

    public function getTemplateForPromotion(int $templateId): ?array {
        $stmt = $this->db->prepare("SELECT * FROM entry_templates WHERE id = ? AND promotion_requested = 1");
        $stmt->execute([$templateId]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return $row ?: null;
    }

    public function createGlobalTemplate(array $templateData): int {
        $stmt = $this->db->prepare(
            "INSERT INTO entry_templates (template_key, owner_id, name, icon, country_code, subtype, schema_version, fields)
             VALUES (?, NULL, ?, ?, ?, ?, ?, ?)"
        );
        $stmt->execute([
            $templateData['template_key'],
            $templateData['name'],
            $templateData['icon'],
            $templateData['country_code'],
            $templateData['subtype'],
            $templateData['schema_version'],
            $templateData['fields'],
        ]);
        return (int)$this->db->lastInsertId();
    }

    public function clearPromotionRequest(int $templateId): void {
        $this->db->prepare(
            "UPDATE entry_templates SET promotion_requested = 0, promotion_requested_at = NULL WHERE id = ?"
        )->execute([$templateId]);
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
    // Account Types
    // =========================================================================

    public function getAccountTypes(): array {
        $stmt = $this->db->query("SELECT * FROM account_types ORDER BY is_system DESC, name ASC");
        return $stmt->fetchAll();
    }

    public function createAccountType(array $data): int {
        $stmt = $this->db->prepare(
            "INSERT INTO account_types (name, description, icon, created_by, is_system)
             VALUES (?, ?, ?, ?, 0)"
        );
        $stmt->execute([
            $data['name'],
            $data['description'] ?? null,
            $data['icon'] ?? 'bank',
            $data['created_by'],
        ]);
        return (int)$this->db->lastInsertId();
    }

    public function getAccountType(int $id): ?array {
        $stmt = $this->db->prepare("SELECT * FROM account_types WHERE id = ?");
        $stmt->execute([$id]);
        $row = $stmt->fetch();
        return $row ?: null;
    }

    public function updateAccountType(int $id, array $fields): void {
        $setClauses = [];
        $params = [];
        foreach ($fields as $col => $val) {
            $setClauses[] = "$col = ?";
            $params[] = $val;
        }
        $params[] = $id;
        $stmt = $this->db->prepare(
            "UPDATE account_types SET " . implode(', ', $setClauses) . " WHERE id = ?"
        );
        $stmt->execute($params);
    }

    public function deleteAccountType(int $id): void {
        $stmt = $this->db->prepare("DELETE FROM account_types WHERE id = ?");
        $stmt->execute([$id]);
    }

    public function getAccountTypeUsageCount(int $id): int {
        $stmt = $this->db->prepare("SELECT COUNT(*) AS cnt FROM accounts WHERE account_type_id = ?");
        $stmt->execute([$id]);
        return (int)$stmt->fetch()['cnt'];
    }

    // =========================================================================
    // Asset Types
    // =========================================================================

    public function getAssetTypes(): array {
        $stmt = $this->db->query("SELECT * FROM asset_types ORDER BY is_system DESC, name ASC");
        return $stmt->fetchAll();
    }

    public function createAssetType(array $data): int {
        $stmt = $this->db->prepare(
            "INSERT INTO asset_types (name, category, json_schema, icon, created_by, is_system)
             VALUES (?, ?, ?, ?, ?, 0)"
        );
        $stmt->execute([
            $data['name'],
            $data['category'] ?? 'other',
            $data['json_schema'] ?? '[]',
            $data['icon'] ?? 'circle',
            $data['created_by'],
        ]);
        return (int)$this->db->lastInsertId();
    }

    public function getAssetType(int $id): ?array {
        $stmt = $this->db->prepare("SELECT * FROM asset_types WHERE id = ?");
        $stmt->execute([$id]);
        $row = $stmt->fetch();
        return $row ?: null;
    }

    public function updateAssetType(int $id, array $fields): void {
        $setClauses = [];
        $params = [];
        foreach ($fields as $col => $val) {
            $setClauses[] = "$col = ?";
            $params[] = $val;
        }
        $params[] = $id;
        $stmt = $this->db->prepare(
            "UPDATE asset_types SET " . implode(', ', $setClauses) . " WHERE id = ?"
        );
        $stmt->execute($params);
    }

    public function deleteAssetType(int $id): void {
        $stmt = $this->db->prepare("DELETE FROM asset_types WHERE id = ?");
        $stmt->execute([$id]);
    }

    public function getAssetTypeUsageCount(int $id): int {
        $stmt = $this->db->prepare("SELECT COUNT(*) AS cnt FROM assets WHERE asset_type_id = ?");
        $stmt->execute([$id]);
        return (int)$stmt->fetch()['cnt'];
    }

    // =========================================================================
    // Countries
    // =========================================================================

    public function getCountries(bool $includeInactive = false): array {
        $where = $includeInactive ? '' : 'WHERE IFNULL(c.is_active, 1) = 1';
        $stmt = $this->db->query(
            "SELECT c.id, c.name, c.code, c.flag_emoji, c.display_order, c.is_active, c.default_currency_id,
                    cu.code AS default_currency_code, cu.symbol AS default_currency_symbol
             FROM countries c
             LEFT JOIN currencies cu ON c.default_currency_id = cu.id
             $where
             ORDER BY c.display_order ASC, c.name ASC"
        );
        return $stmt->fetchAll();
    }

    public function createCountry(array $data): int {
        $stmt = $this->db->prepare(
            "INSERT INTO countries (name, code, flag_emoji, default_currency_id)
             VALUES (?, ?, ?, ?)"
        );
        $stmt->execute([
            $data['name'],
            $data['code'],
            $data['flag_emoji'] ?? null,
            $data['default_currency_id'] ?? null,
        ]);
        return (int)$this->db->lastInsertId();
    }

    public function getCountry(int $id): ?array {
        $stmt = $this->db->prepare("SELECT * FROM countries WHERE id = ?");
        $stmt->execute([$id]);
        $row = $stmt->fetch();
        return $row ?: null;
    }

    public function updateCountry(int $id, array $fields): void {
        $setClauses = [];
        $params = [];
        foreach ($fields as $col => $val) {
            $setClauses[] = "$col = ?";
            $params[] = $val;
        }
        $params[] = $id;
        $stmt = $this->db->prepare(
            "UPDATE countries SET " . implode(', ', $setClauses) . " WHERE id = ?"
        );
        $stmt->execute($params);
    }

    public function deleteCountry(int $id): void {
        $stmt = $this->db->prepare("DELETE FROM countries WHERE id = ?");
        $stmt->execute([$id]);
    }

    public function getCountryUsageCount(int $id): int {
        $stmt = $this->db->prepare("SELECT COUNT(*) AS cnt FROM accounts WHERE country_id = ?");
        $stmt->execute([$id]);
        return (int)$stmt->fetch()['cnt'];
    }

    // =========================================================================
    // Currencies
    // =========================================================================

    public function getCurrencies(bool $includeInactive = false): array {
        if ($includeInactive) {
            $stmt = $this->db->query("SELECT * FROM currencies ORDER BY display_order ASC, name ASC");
        } else {
            $stmt = $this->db->query("SELECT * FROM currencies WHERE IFNULL(is_active, 1) = 1 ORDER BY display_order ASC, name ASC");
        }
        return $stmt->fetchAll();
    }

    public function createCurrency(array $data): int {
        $stmt = $this->db->prepare(
            "INSERT INTO currencies (name, code, symbol, is_active, exchange_rate_to_base) VALUES (?, ?, ?, ?, ?)"
        );
        $stmt->execute([
            $data['name'],
            $data['code'],
            $data['symbol'],
            $data['is_active'] ?? 1,
            $data['exchange_rate_to_base'] ?? 1.0,
        ]);
        return (int)$this->db->lastInsertId();
    }

    public function getCurrency(int $id): ?array {
        $stmt = $this->db->prepare("SELECT * FROM currencies WHERE id = ?");
        $stmt->execute([$id]);
        $row = $stmt->fetch();
        return $row ?: null;
    }

    public function updateCurrency(int $id, array $fields): void {
        $setClauses = [];
        $params = [];
        foreach ($fields as $col => $val) {
            $setClauses[] = "$col = ?";
            $params[] = $val;
        }
        $params[] = $id;
        $stmt = $this->db->prepare(
            "UPDATE currencies SET " . implode(', ', $setClauses) . " WHERE id = ?"
        );
        $stmt->execute($params);
    }

    // =========================================================================
    // Exchanges
    // =========================================================================

    public function getExchanges(): array {
        $stmt = $this->db->query(
            'SELECT e.*, c.name AS country_name
             FROM exchanges e
             LEFT JOIN countries c ON c.code = e.country_code
             ORDER BY e.country_code, e.display_order, e.name'
        );
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    public function createExchange(array $data): int {
        $stmt = $this->db->prepare(
            'INSERT INTO exchanges (country_code, name, suffix, display_order)
             VALUES (?, ?, ?, ?)'
        );
        $stmt->execute([
            $data['country_code'],
            $data['name'],
            $data['suffix'] ?? '',
            $data['display_order'] ?? 0,
        ]);
        return (int)$this->db->lastInsertId();
    }

    public function getExchange(int $id): ?array {
        $stmt = $this->db->prepare('SELECT * FROM exchanges WHERE id = ?');
        $stmt->execute([$id]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return $row ?: null;
    }

    public function updateExchange(int $id, array $fields): void {
        $setClauses = [];
        $params = [];
        foreach ($fields as $col => $val) {
            $setClauses[] = "$col = ?";
            $params[] = $val;
        }
        $params[] = $id;
        $stmt = $this->db->prepare(
            'UPDATE exchanges SET ' . implode(', ', $setClauses) . ' WHERE id = ?'
        );
        $stmt->execute($params);
    }

    public function deleteExchange(int $id): bool {
        $stmt = $this->db->prepare('DELETE FROM exchanges WHERE id = ?');
        $stmt->execute([$id]);
        return $stmt->rowCount() > 0;
    }

    // =========================================================================
    // Historical Rates
    // =========================================================================

    public function getHistoricalRates(string $date): array {
        $stmt = $this->db->prepare(
            'SELECT c.code, crh.rate_to_base, crh.base_currency
             FROM currency_rate_history crh
             JOIN currencies c ON crh.currency_id = c.id
             WHERE crh.recorded_at = ?'
        );
        $stmt->execute([$date]);
        return $stmt->fetchAll();
    }

    // =========================================================================
    // Prices
    // =========================================================================

    public function getCachedPrices(array $tickers, int $ttlSeconds): array {
        if (empty($tickers)) {
            return [];
        }
        $placeholders = str_repeat('?,', count($tickers) - 1) . '?';
        $stmt = $this->db->prepare(
            "SELECT ticker, exchange, price, currency, name, fetched_at
             FROM ticker_prices
             WHERE ticker IN ($placeholders)
             AND fetched_at > DATE_SUB(NOW(), INTERVAL ? SECOND)"
        );
        $params = array_values($tickers);
        $params[] = $ttlSeconds;
        $stmt->execute($params);
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    public function upsertPrice(string $ticker, string $exchange, float $price, string $currency, string $name): void {
        $stmt = $this->db->prepare(
            'INSERT INTO ticker_prices (ticker, exchange, price, currency, name, fetched_at)
             VALUES (?, ?, ?, ?, ?, NOW())
             ON DUPLICATE KEY UPDATE exchange = VALUES(exchange), price = VALUES(price),
             currency = VALUES(currency), name = VALUES(name), fetched_at = NOW()'
        );
        $stmt->execute([$ticker, $exchange, $price, $currency, $name]);
    }

    public function addPriceHistory(string $ticker, string $exchange, float $price, string $currency): void {
        $stmt = $this->db->prepare(
            'INSERT INTO ticker_price_history (ticker, exchange, price, currency, recorded_at)
             VALUES (?, ?, ?, ?, CURDATE())
             ON DUPLICATE KEY UPDATE price = VALUES(price), exchange = VALUES(exchange)'
        );
        $stmt->execute([$ticker, $exchange, $price, $currency]);
    }

    public function getAllCachedPrices(): array {
        $stmt = $this->db->query('SELECT * FROM ticker_prices ORDER BY fetched_at DESC');
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    public function clearPriceCache(): void {
        $this->db->exec('TRUNCATE TABLE ticker_prices');
    }

    // =========================================================================
    // Exchange Rates
    // =========================================================================

    public function getLastCurrencyUpdate(): ?string {
        $stmt = $this->db->query("SELECT MAX(last_updated) AS last FROM currencies");
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return $row['last'] ?? null;
    }

    public function getAllCurrenciesForUpdate(): array {
        $stmt = $this->db->query("SELECT id, code FROM currencies");
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    public function updateExchangeRate(int $currencyId, float $rate): void {
        $stmt = $this->db->prepare(
            "UPDATE currencies SET exchange_rate_to_base = ?, last_updated = NOW() WHERE id = ?"
        );
        $stmt->execute([$rate, $currencyId]);
    }

    public function addCurrencyRateHistory(int $currencyId, float $rate, string $baseCurrency): void {
        $stmt = $this->db->prepare(
            "INSERT INTO currency_rate_history (currency_id, rate_to_base, base_currency, recorded_at)
             VALUES (?, ?, ?, CURDATE())
             ON DUPLICATE KEY UPDATE rate_to_base = VALUES(rate_to_base), base_currency = VALUES(base_currency)"
        );
        $stmt->execute([$currencyId, $rate, $baseCurrency]);
    }

    // =========================================================================
    // Account Detail Templates
    // =========================================================================

    public function getAccountDetailTemplates(int $userId): array {
        $stmt = $this->db->prepare(
            "SELECT id, user_id, account_type_id, subtype, country_id,
                    IFNULL(is_global, 0) AS is_global, field_keys
             FROM account_detail_templates
             WHERE user_id = ? OR (IFNULL(is_global, 0) = 1)
             ORDER BY is_global ASC, updated_at DESC"
        );
        $stmt->execute([$userId]);
        return $stmt->fetchAll();
    }

    public function upsertAccountDetailTemplate(int $userId, array $data): int {
        $accountTypeId = $data['account_type_id'];
        $subtype       = $data['subtype'];
        $countryId     = $data['country_id'];
        $fieldKeysJson = $data['field_keys'];
        $scope         = $data['scope'] ?? 'personal';

        if ($scope === 'global') {
            // Check if a global row already exists for this combo
            $stmt = $this->db->prepare(
                "SELECT id FROM account_detail_templates
                 WHERE user_id = 0 AND account_type_id = ? AND subtype = ? AND country_id = ? AND IFNULL(is_global, 0) = 1"
            );
            $stmt->execute([$accountTypeId, $subtype, $countryId]);
            $existing = $stmt->fetch();

            if ($existing) {
                // Admin overwrites existing global template
                $stmt = $this->db->prepare(
                    "UPDATE account_detail_templates SET field_keys = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
                );
                $stmt->execute([$fieldKeysJson, (int)$existing['id']]);
                return (int)$existing['id'];
            } else {
                // New global template
                $stmt = $this->db->prepare(
                    "INSERT INTO account_detail_templates
                        (user_id, account_type_id, subtype, country_id, is_global, field_keys)
                     VALUES (0, ?, ?, ?, 1, ?)"
                );
                $stmt->execute([$accountTypeId, $subtype, $countryId, $fieldKeysJson]);
                return (int)$this->db->lastInsertId();
            }
        } else {
            // Personal template: user_id = actual user, is_global = 0
            $stmt = $this->db->prepare(
                "INSERT INTO account_detail_templates
                    (user_id, account_type_id, subtype, country_id, is_global, field_keys)
                 VALUES (?, ?, ?, ?, 0, ?)
                 ON DUPLICATE KEY UPDATE field_keys = VALUES(field_keys), updated_at = CURRENT_TIMESTAMP"
            );
            $stmt->execute([$userId, $accountTypeId, $subtype, $countryId, $fieldKeysJson]);
            return (int)$this->db->lastInsertId();
        }
    }

    public function getAccountDetailTemplate(int $id): ?array {
        $stmt = $this->db->prepare(
            "SELECT id, user_id, IFNULL(is_global, 0) AS is_global FROM account_detail_templates WHERE id = ?"
        );
        $stmt->execute([$id]);
        $row = $stmt->fetch();
        return $row ?: null;
    }

    public function deleteAccountDetailTemplate(int $id): void {
        $stmt = $this->db->prepare("DELETE FROM account_detail_templates WHERE id = ?");
        $stmt->execute([$id]);
    }

    // =========================================================================
    // User Management
    // =========================================================================

    public function getActiveUsersSimple(int $excludeUserId): array {
        $stmt = $this->db->prepare(
            "SELECT id, username FROM users WHERE is_active = 1 AND id != ? ORDER BY username"
        );
        $stmt->execute([$excludeUserId]);
        return $stmt->fetchAll();
    }

    public function getAllUsersWithVaultKeyStatus(): array {
        $stmt = $this->db->query(
            "SELECT u.id, u.username, u.display_name, u.email, u.role, u.is_active, u.created_at,
                    CASE WHEN vk.user_id IS NOT NULL THEN 1 ELSE 0 END AS has_vault_key,
                    COALESCE(vk.must_reset_vault_key, 0) AS must_reset_vault_key
             FROM users u
             LEFT JOIN user_vault_keys vk ON vk.user_id = u.id
             ORDER BY u.id"
        );
        return $stmt->fetchAll();
    }

    public function createUserByAdmin(array $data): int {
        $stmt = $this->db->prepare(
            "INSERT INTO users (username, display_name, email, password_hash, role, email_verified, must_reset_password) VALUES (?, ?, ?, ?, ?, 1, 1)"
        );
        $stmt->execute([
            $data['username'],
            $data['display_name'],
            $data['email'],
            $data['password_hash'],
            $data['role'],
        ]);
        return (int)$this->db->lastInsertId();
    }

    /**
     * Column whitelist for dynamic user updates.
     */
    private const USER_UPDATE_COLUMNS = [
        'username', 'email', 'password_hash', 'role', 'is_active', 'must_reset_password',
    ];

    public function updateUser(int $id, array $fields): void {
        $filtered = array_intersect_key($fields, array_flip(self::USER_UPDATE_COLUMNS));
        if (empty($filtered)) {
            return;
        }

        $setClauses = [];
        $params = [];
        foreach ($filtered as $col => $val) {
            $setClauses[] = "`{$col}` = ?";
            $params[] = $val;
        }
        $params[] = $id;

        $sql = "UPDATE users SET " . implode(', ', $setClauses) . " WHERE id = ?";
        $stmt = $this->db->prepare($sql);
        $stmt->execute($params);
    }

    public function deleteUser(int $id): bool {
        $stmt = $this->db->prepare("DELETE FROM users WHERE id = ?");
        $stmt->execute([$id]);
        return $stmt->rowCount() > 0;
    }

    // =========================================================================
    // Dashboard
    // =========================================================================

    public function getSharedWithMeCount(int $userId): int {
        $stmt = $this->db->prepare("SELECT COUNT(*) FROM shared_items WHERE recipient_id = ?");
        $stmt->execute([$userId]);
        return (int)$stmt->fetchColumn();
    }

    public function getLastAuditEvent(int $userId, string $action): ?string {
        $stmt = $this->db->prepare(
            "SELECT MAX(created_at) FROM audit_log WHERE user_id = ? AND action = ?"
        );
        $stmt->execute([$userId, $action]);
        $result = $stmt->fetchColumn();
        return $result ?: null;
    }

    // =========================================================================
    // Sync
    // =========================================================================

    public function getMaxEntryUpdatedAt(int $userId): ?string {
        $stmt = $this->db->prepare("SELECT MAX(updated_at) FROM vault_entries WHERE user_id = ?");
        $stmt->execute([$userId]);
        $result = $stmt->fetchColumn();
        return $result ?: null;
    }

    public function getMaxCountryUpdatedAt(): ?string {
        $stmt = $this->db->query("SELECT MAX(updated_at) FROM countries");
        $result = $stmt->fetchColumn();
        return $result ?: null;
    }

    public function getMaxTemplateUpdatedAt(int $userId): ?string {
        $stmt = $this->db->prepare(
            "SELECT MAX(updated_at) FROM entry_templates WHERE owner_id IS NULL OR owner_id = ?"
        );
        $stmt->execute([$userId]);
        $result = $stmt->fetchColumn();
        return $result ?: null;
    }

    // =========================================================================
    // Invitations
    // =========================================================================

    public function checkEmailRegistered(string $email): bool {
        $stmt = $this->db->prepare("SELECT id FROM users WHERE email = ? LIMIT 1");
        $stmt->execute([$email]);
        return (bool)$stmt->fetch();
    }

    public function getExistingInvitation(string $email): ?array {
        $stmt = $this->db->prepare(
            "SELECT id, token, expires_at FROM invitations
             WHERE email = ? AND used_at IS NULL AND expires_at > NOW()
             ORDER BY created_at DESC LIMIT 1"
        );
        $stmt->execute([$email]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return $row ?: null;
    }

    public function createInvitation(array $data): int {
        $stmt = $this->db->prepare(
            "INSERT INTO invitations (token, email, invited_by, expires_at) VALUES (?, ?, ?, ?)"
        );
        $stmt->execute([
            $data['token'],
            $data['email'],
            $data['invited_by'],
            $data['expires_at'],
        ]);
        return (int)$this->db->lastInsertId();
    }

    public function validateInviteToken(string $token): ?array {
        $stmt = $this->db->prepare(
            "SELECT i.id, i.email, i.expires_at, i.used_at, u.username AS invited_by_username
             FROM invitations i
             JOIN users u ON u.id = i.invited_by
             WHERE i.token = ? LIMIT 1"
        );
        $stmt->execute([$token]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return $row ?: null;
    }

    public function getInvitationsByUser(int $userId): array {
        $stmt = $this->db->prepare(
            "SELECT id, email, token, expires_at, used_at, created_at
             FROM invitations WHERE invited_by = ?
             ORDER BY created_at DESC LIMIT 50"
        );
        $stmt->execute([$userId]);
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    public function getAllInvitations(): array {
        $stmt = $this->db->query(
            "SELECT i.id, i.email, i.token, i.expires_at, i.used_at, i.created_at,
                    u.username AS invited_by_username
             FROM invitations i
             JOIN users u ON u.id = i.invited_by
             ORDER BY i.created_at DESC LIMIT 100"
        );
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    public function getInvitation(int $id): ?array {
        $stmt = $this->db->prepare("SELECT id, invited_by, used_at FROM invitations WHERE id = ?");
        $stmt->execute([$id]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return $row ?: null;
    }

    public function deleteInvitation(int $id): void {
        $stmt = $this->db->prepare("DELETE FROM invitations WHERE id = ?");
        $stmt->execute([$id]);
    }

    public function markInvitationUsed(int $id): void {
        $stmt = $this->db->prepare("UPDATE invitations SET used_at = NOW() WHERE id = ?");
        $stmt->execute([$id]);
    }

    // =========================================================================
    // Invite Requests
    // =========================================================================

    public function checkExistingInviteRequest(string $email): bool {
        $stmt = $this->db->prepare("SELECT id FROM invite_requests WHERE email = ? LIMIT 1");
        $stmt->execute([$email]);
        return (bool)$stmt->fetch();
    }

    public function createInviteRequest(string $email, ?string $name, string $ipHash): int {
        $stmt = $this->db->prepare(
            "INSERT INTO invite_requests (email, name, ip_hash) VALUES (?, ?, ?)"
        );
        $stmt->execute([$email, $name, $ipHash]);
        return (int)$this->db->lastInsertId();
    }

    public function checkActiveInviteForEmail(string $email): bool {
        $stmt = $this->db->prepare(
            "SELECT id FROM invitations WHERE email = ? AND used_at IS NULL AND expires_at > NOW() LIMIT 1"
        );
        $stmt->execute([$email]);
        return (bool)$stmt->fetch();
    }

    // =========================================================================
    // Maintenance
    // =========================================================================

    public function cleanupRateLimits(): int {
        $stmt = $this->db->prepare("DELETE FROM rate_limits WHERE window_start < NOW() - INTERVAL 7 DAY");
        $stmt->execute();
        return $stmt->rowCount();
    }

    public function cleanupInviteRequests(): int {
        $stmt = $this->db->prepare(
            "DELETE FROM invite_requests WHERE status IN ('rejected','ignored') AND created_at < NOW() - INTERVAL 30 DAY"
        );
        $stmt->execute();
        return $stmt->rowCount();
    }

    public function cleanupAuditLogOperational(): int {
        $stmt = $this->db->prepare(
            "DELETE FROM audit_log WHERE created_at < NOW() - INTERVAL 30 DAY
             AND action IN ('share_created', 'share_revoked', 'system_setting_changed')"
        );
        $stmt->execute();
        return $stmt->rowCount();
    }

    public function cleanupAuditLogOld(): int {
        $stmt = $this->db->prepare(
            "DELETE FROM audit_log WHERE created_at < NOW() - INTERVAL 90 DAY"
        );
        $stmt->execute();
        return $stmt->rowCount();
    }

    // =========================================================================
    // Auth — Users
    // =========================================================================

    public function getUserById(int $id): ?array {
        $stmt = $this->db->prepare(
            "SELECT id, username, display_name, email, role, must_reset_password, created_at FROM users WHERE id = ?"
        );
        $stmt->execute([$id]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return $row ?: null;
    }

    public function getUserByIdentifier(string $usernameOrEmail): ?array {
        $stmt = $this->db->prepare(
            "SELECT id, username, display_name, email, password_hash, role, is_active, must_reset_password
             FROM users WHERE username = ? OR email = ? LIMIT 1"
        );
        $stmt->execute([$usernameOrEmail, $usernameOrEmail]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return $row ?: null;
    }

    public function getUserActiveAndRole(int $userId): ?array {
        $stmt = $this->db->prepare("SELECT is_active, role, must_reset_password FROM users WHERE id = ?");
        $stmt->execute([$userId]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return $row ?: null;
    }

    public function getEmailVerifiedStatus(int $userId): ?bool {
        $stmt = $this->db->prepare("SELECT email_verified FROM users WHERE id = ?");
        $stmt->execute([$userId]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$row) return null;
        return (bool)(int)$row['email_verified'];
    }

    public function getUserByEmailVerifyToken(string $token): ?array {
        $stmt = $this->db->prepare(
            "SELECT id, email_verify_expires FROM users
             WHERE email_verify_token = ? AND email_verified = 0 LIMIT 1"
        );
        $stmt->execute([$token]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return $row ?: null;
    }

    public function markEmailVerified(int $userId): void {
        $stmt = $this->db->prepare(
            "UPDATE users SET email_verified = 1, email_verify_token = NULL, email_verify_expires = NULL WHERE id = ?"
        );
        $stmt->execute([$userId]);
    }

    public function getUserRsaKeyStatus(int $userId): array {
        $stmt = $this->db->prepare("SELECT public_key, encrypted_private_key FROM users WHERE id = ?");
        $stmt->execute([$userId]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return [
            'has_public_key'            => !empty($row['public_key']),
            'has_encrypted_private_key' => !empty($row['encrypted_private_key']),
        ];
    }

    public function checkDuplicateUser(string $username, string $email, ?int $excludeUserId = null): bool {
        $conditions = [];
        $params = [];

        if ($username !== '') {
            $conditions[] = 'username = ?';
            $params[] = $username;
        }
        if ($email !== '') {
            $conditions[] = 'email = ?';
            $params[] = $email;
        }
        if (empty($conditions)) {
            return false;
        }

        $sql = "SELECT id FROM users WHERE (" . implode(' OR ', $conditions) . ")";
        if ($excludeUserId !== null) {
            $sql .= " AND id != ?";
            $params[] = $excludeUserId;
        }

        $stmt = $this->db->prepare($sql);
        $stmt->execute($params);
        return (bool)$stmt->fetch();
    }

    public function createUserFromRegistration(array $data): int {
        $stmt = $this->db->prepare(
            "INSERT INTO users (username, email, password_hash, role, is_active, email_verified, email_verify_token, email_verify_expires)
             VALUES (?, ?, ?, ?, 1, ?, ?, ?)"
        );
        $stmt->execute([
            $data['username'],
            $data['email'],
            $data['password_hash'],
            $data['role'],
            $data['email_verified'],
            $data['email_verify_token'],
            $data['email_verify_expires'],
        ]);
        return (int)$this->db->lastInsertId();
    }

    public function updateUserProfile(int $userId, array $fields): void {
        $allowed = ['username', 'display_name', 'email'];
        $setClauses = [];
        $params = [];
        foreach ($fields as $col => $val) {
            if (in_array($col, $allowed, true)) {
                $setClauses[] = "$col = ?";
                $params[] = $val;
            }
        }
        if (empty($setClauses)) {
            return;
        }
        $params[] = $userId;
        $sql = "UPDATE users SET " . implode(', ', $setClauses) . " WHERE id = ?";
        $stmt = $this->db->prepare($sql);
        $stmt->execute($params);
    }

    public function getPasswordHash(int $userId): ?string {
        $stmt = $this->db->prepare("SELECT password_hash FROM users WHERE id = ?");
        $stmt->execute([$userId]);
        $result = $stmt->fetchColumn();
        return $result ?: null;
    }

    public function updateUserPassword(int $userId, string $hash): void {
        $stmt = $this->db->prepare("UPDATE users SET password_hash = ? WHERE id = ?");
        $stmt->execute([$hash, $userId]);
    }

    public function resetPasswordAndUnlock(int $userId, string $hash): void {
        $stmt = $this->db->prepare(
            "UPDATE users SET password_hash = ?, must_reset_password = 0,
             failed_login_attempts = 0, locked_until = NULL, last_failed_login_at = NULL
             WHERE id = ?"
        );
        $stmt->execute([$hash, $userId]);
    }

    public function getMustResetPassword(int $userId): ?bool {
        $stmt = $this->db->prepare("SELECT must_reset_password FROM users WHERE id = ?");
        $stmt->execute([$userId]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$row) return null;
        return (bool)$row['must_reset_password'];
    }

    public function getAdminCount(int $excludeUserId): int {
        $stmt = $this->db->prepare(
            "SELECT COUNT(*) AS cnt FROM users WHERE role = 'admin' AND is_active = 1 AND id != ?"
        );
        $stmt->execute([$excludeUserId]);
        return (int)$stmt->fetch()['cnt'];
    }

    public function deleteUserById(int $userId): bool {
        $stmt = $this->db->prepare("DELETE FROM users WHERE id = ?");
        $stmt->execute([$userId]);
        return $stmt->rowCount() > 0;
    }

    public function getUserWithRecoveryMaterial(string $usernameOrEmail): ?array {
        $stmt = $this->db->prepare(
            "SELECT u.id, u.is_active, v.recovery_key_salt, v.encrypted_dek_recovery
             FROM users u
             LEFT JOIN user_vault_keys v ON v.user_id = u.id
             WHERE (u.username = ? OR u.email = ?) LIMIT 1"
        );
        $stmt->execute([$usernameOrEmail, $usernameOrEmail]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return $row ?: null;
    }

    public function getUsernameById(int $userId): ?string {
        $stmt = $this->db->prepare("SELECT username FROM users WHERE id = ?");
        $stmt->execute([$userId]);
        $result = $stmt->fetchColumn();
        return $result ?: null;
    }

    // =========================================================================
    // Auth — Lockout & Rate Limiting
    // =========================================================================

    public function incrementFailedLogin(int $userId): void {
        $stmt = $this->db->prepare(
            "UPDATE users SET failed_login_attempts = failed_login_attempts + 1, last_failed_login_at = NOW() WHERE id = ?"
        );
        $stmt->execute([$userId]);
    }

    public function getFailedLoginInfo(int $userId): ?array {
        $stmt = $this->db->prepare("SELECT failed_login_attempts, email FROM users WHERE id = ?");
        $stmt->execute([$userId]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return $row ?: null;
    }

    public function setUserMustResetPassword(int $userId, bool $must): void {
        $stmt = $this->db->prepare("UPDATE users SET must_reset_password = ? WHERE id = ?");
        $stmt->execute([$must ? 1 : 0, $userId]);
    }

    public function setUserLockedUntil(int $userId, ?string $until): void {
        $stmt = $this->db->prepare("UPDATE users SET locked_until = ? WHERE id = ?");
        $stmt->execute([$until, $userId]);
    }

    public function resetLoginLockout(int $userId): void {
        $stmt = $this->db->prepare(
            "UPDATE users SET failed_login_attempts = 0, locked_until = NULL, last_failed_login_at = NULL WHERE id = ?"
        );
        $stmt->execute([$userId]);
    }

    public function getUserLockoutStatus(int $userId): ?array {
        $stmt = $this->db->prepare("SELECT locked_until FROM users WHERE id = ?");
        $stmt->execute([$userId]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return $row ?: null;
    }

    public function getRateLimit(string $action, string $identifier): ?array {
        $stmt = $this->db->prepare(
            "SELECT attempts, window_start FROM rate_limits WHERE action = ? AND identifier = ? LIMIT 1"
        );
        $stmt->execute([$action, $identifier]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return $row ?: null;
    }

    public function upsertRateLimit(string $action, string $identifier): void {
        $stmt = $this->db->prepare(
            "INSERT INTO rate_limits (action, identifier, attempts, window_start)
             VALUES (?, ?, 1, NOW())
             ON DUPLICATE KEY UPDATE attempts = attempts + 1"
        );
        $stmt->execute([$action, $identifier]);
    }

    public function deleteRateLimit(string $action, string $identifier): void {
        $stmt = $this->db->prepare("DELETE FROM rate_limits WHERE action = ? AND identifier = ?");
        $stmt->execute([$action, $identifier]);
    }

    public function deleteExpiredRateLimits(int $windowSeconds): void {
        $stmt = $this->db->prepare(
            "DELETE FROM rate_limits WHERE window_start < DATE_SUB(NOW(), INTERVAL ? SECOND)"
        );
        $stmt->execute([$windowSeconds]);
    }

    // =========================================================================
    // Auth — Password History
    // =========================================================================

    public function getPasswordHistory(int $userId, int $limit): array {
        $stmt = $this->db->prepare(
            "SELECT password_hash FROM password_history
             WHERE user_id = ? ORDER BY created_at DESC LIMIT ?"
        );
        $stmt->execute([$userId, $limit]);
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    public function addPasswordHistory(int $userId, string $hash): void {
        $stmt = $this->db->prepare(
            "INSERT INTO password_history (user_id, password_hash) VALUES (?, ?)"
        );
        $stmt->execute([$userId, $hash]);
    }

    public function prunePasswordHistory(int $userId, int $keepCount): void {
        // MySQL does not support LIMIT ? in subqueries, so $keepCount is interpolated.
        // The int type hint + explicit cast prevent injection.
        $limit = (int) $keepCount;
        $stmt = $this->db->prepare(
            "DELETE FROM password_history WHERE user_id = ? AND id NOT IN (
                SELECT id FROM (
                    SELECT id FROM password_history WHERE user_id = ? ORDER BY created_at DESC LIMIT $limit
                ) AS recent
            )"
        );
        $stmt->execute([$userId, $userId]);
    }

    // =========================================================================
    // WebAuthn
    // =========================================================================

    public function createWebAuthnChallenge(?int $userId, string $challenge, string $type): int {
        $stmt = $this->db->prepare(
            "INSERT INTO webauthn_challenges (challenge, user_id, type, expires_at)
             VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 5 MINUTE))"
        );
        $stmt->execute([$challenge, $userId, $type]);
        return (int)$this->db->lastInsertId();
    }

    public function getWebAuthnChallenge(int $challengeId): ?array {
        $stmt = $this->db->prepare(
            "SELECT challenge, user_id, type FROM webauthn_challenges
             WHERE id = ? AND expires_at > NOW()"
        );
        $stmt->execute([$challengeId]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return $row ?: null;
    }

    public function deleteWebAuthnChallenge(int $challengeId): void {
        $stmt = $this->db->prepare("DELETE FROM webauthn_challenges WHERE id = ?");
        $stmt->execute([$challengeId]);
    }

    public function getExistingCredentialIds(int $userId): array {
        $stmt = $this->db->prepare(
            "SELECT credential_id FROM user_credentials_webauthn WHERE user_id = ?"
        );
        $stmt->execute([$userId]);
        return $stmt->fetchAll(PDO::FETCH_COLUMN);
    }

    public function registerWebAuthnCredential(int $userId, string $credentialId, string $publicKey, int $signCount, string $transports, string $name): int {
        $stmt = $this->db->prepare(
            "INSERT INTO user_credentials_webauthn
             (user_id, credential_id, public_key, sign_count, transports, name, created_at, last_used_at)
             VALUES (?, ?, ?, ?, ?, ?, NOW(), NULL)"
        );
        $stmt->execute([$userId, $credentialId, $publicKey, $signCount, $transports, $name]);
        return (int)$this->db->lastInsertId();
    }

    public function getWebAuthnCredentialForAuth(string $credentialId): ?array {
        $stmt = $this->db->prepare(
            "SELECT wc.user_id, wc.public_key, wc.sign_count, wc.credential_id,
                    u.id, u.username, u.email, u.role, u.is_active
             FROM user_credentials_webauthn wc
             JOIN users u ON u.id = wc.user_id
             WHERE wc.credential_id = ?"
        );
        $stmt->execute([$credentialId]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return $row ?: null;
    }

    public function updateWebAuthnCredentialUsage(string $credentialId, int $signCount): void {
        $stmt = $this->db->prepare(
            "UPDATE user_credentials_webauthn
             SET sign_count = ?, last_used_at = NOW()
             WHERE credential_id = ?"
        );
        $stmt->execute([$signCount, $credentialId]);
    }

    public function listWebAuthnCredentials(int $userId): array {
        $stmt = $this->db->prepare(
            "SELECT id, credential_id, name, transports, created_at, last_used_at
             FROM user_credentials_webauthn
             WHERE user_id = ?
             ORDER BY created_at DESC"
        );
        $stmt->execute([$userId]);
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    public function getWebAuthnCredentialOwnership(int $credentialId, int $userId): bool {
        $stmt = $this->db->prepare(
            "SELECT id FROM user_credentials_webauthn WHERE id = ? AND user_id = ?"
        );
        $stmt->execute([$credentialId, $userId]);
        return (bool)$stmt->fetch();
    }

    public function renameWebAuthnCredential(int $credentialId, int $userId, string $name): void {
        $stmt = $this->db->prepare(
            "UPDATE user_credentials_webauthn SET name = ? WHERE id = ? AND user_id = ?"
        );
        $stmt->execute([$name, $credentialId, $userId]);
    }

    public function deleteWebAuthnCredential(int $credentialId, int $userId): void {
        $stmt = $this->db->prepare(
            "DELETE FROM user_credentials_webauthn WHERE id = ? AND user_id = ?"
        );
        $stmt->execute([$credentialId, $userId]);
    }

    // =========================================================================
    // Plaid
    // =========================================================================

    public function upsertPlaidItem(int $userId, string $itemId, string $encryptedAccessToken): void {
        $stmt = $this->db->prepare(
            'INSERT INTO plaid_items (user_id, item_id, access_token, status)
             VALUES (?, ?, ?, "active")
             ON DUPLICATE KEY UPDATE access_token = VALUES(access_token), status = "active"'
        );
        $stmt->execute([$userId, $itemId, $encryptedAccessToken]);
    }

    public function getPlaidItems(int $userId, array $itemIds): array {
        if (empty($itemIds)) {
            return [];
        }
        $placeholders = implode(',', array_fill(0, count($itemIds), '?'));
        $stmt = $this->db->prepare(
            "SELECT item_id, access_token FROM plaid_items
             WHERE user_id = ? AND item_id IN ($placeholders)"
        );
        $stmt->execute(array_merge([$userId], $itemIds));
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    public function updatePlaidItemStatus(string $itemId, int $userId, string $status): void {
        $stmt = $this->db->prepare(
            'UPDATE plaid_items SET status = ? WHERE item_id = ? AND user_id = ?'
        );
        $stmt->execute([$status, $itemId, $userId]);
    }

    public function getPlaidItem(int $userId, string $itemId): ?array {
        $stmt = $this->db->prepare(
            'SELECT access_token FROM plaid_items WHERE user_id = ? AND item_id = ?'
        );
        $stmt->execute([$userId, $itemId]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return $row ?: null;
    }

    public function deletePlaidItem(int $userId, string $itemId): void {
        $stmt = $this->db->prepare(
            'DELETE FROM plaid_items WHERE user_id = ? AND item_id = ?'
        );
        $stmt->execute([$userId, $itemId]);
    }

    public function getPlaidItemsByUser(int $userId): array {
        $stmt = $this->db->prepare(
            'SELECT item_id, status, created_at, updated_at
             FROM plaid_items WHERE user_id = ?
             ORDER BY created_at DESC'
        );
        $stmt->execute([$userId]);
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    // =========================================================================
    // Private Helpers
    // =========================================================================

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
