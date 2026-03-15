<?php
/**
 * Citadel Vault — In-Memory Storage Adapter
 *
 * Test/development storage backend using PHP arrays.
 * No database required. Data lives only for the duration of the PHP process.
 * Uses auto-increment IDs that mimic database behavior.
 */
require_once __DIR__ . '/StorageAdapter.php';

class InMemoryAdapter implements StorageAdapter {

    private const VALID_ENTRY_TYPES = ['password', 'account', 'asset', 'license', 'insurance', 'custom'];

    /** @var array<string, array> Tables keyed by table name */
    private array $entries = [];
    private array $vaultKeys = [];
    private array $preferences = [];
    private array $sharedItems = [];
    private array $snapshots = [];
    private array $auditLog = [];
    private array $templates = [];

    /** @var array<string, int> Auto-increment counters per table */
    private int $entrySeq = 0;
    private int $shareSeq = 0;
    private int $snapshotSeq = 0;
    private int $auditSeq = 0;
    private int $templateSeq = 0;

    // =========================================================================
    // Vault Entries
    // =========================================================================

    public function getEntries(int $userId, ?string $entryType = null): array {
        // Purge expired soft deletes
        $cutoff = date('Y-m-d H:i:s', strtotime('-1 day'));
        $this->entries = array_filter($this->entries, function ($e) use ($cutoff) {
            return $e['deleted_at'] === null || $e['deleted_at'] >= $cutoff;
        });

        $results = array_filter($this->entries, function ($e) use ($userId, $entryType) {
            if ($e['user_id'] !== $userId) return false;
            if ($e['deleted_at'] !== null) return false;
            if ($entryType !== null && $e['entry_type'] !== $entryType) return false;
            return true;
        });

        // Sort by updated_at DESC
        usort($results, function ($a, $b) {
            return strcmp($b['updated_at'], $a['updated_at']);
        });

        return array_map(function ($e) {
            return [
                'id'             => $e['id'],
                'entry_type'     => $e['entry_type'],
                'template_id'    => $e['template_id'],
                'schema_version' => $e['schema_version'],
                'encrypted_data' => $e['encrypted_data'],
                'template'       => $this->findTemplate($e['template_id']),
                'created_at'     => $e['created_at'],
                'updated_at'     => $e['updated_at'],
            ];
        }, array_values($results));
    }

    public function getEntry(int $userId, int $entryId): ?array {
        $entry = $this->entries[$entryId] ?? null;
        if (!$entry || $entry['user_id'] !== $userId || $entry['deleted_at'] !== null) {
            return null;
        }
        return [
            'id'             => $entry['id'],
            'entry_type'     => $entry['entry_type'],
            'template_id'    => $entry['template_id'],
            'schema_version' => $entry['schema_version'],
            'encrypted_data' => $entry['encrypted_data'],
            'template'       => $this->findTemplate($entry['template_id']),
            'created_at'     => $entry['created_at'],
            'updated_at'     => $entry['updated_at'],
        ];
    }

    public function createEntry(int $userId, string $entryType, string $encryptedData, ?int $templateId = null, int $schemaVersion = 1): int {
        if (!in_array($entryType, self::VALID_ENTRY_TYPES, true)) {
            throw new InvalidArgumentException(
                "Invalid entry type: '{$entryType}'. Allowed: " . implode(', ', self::VALID_ENTRY_TYPES)
            );
        }

        $id = ++$this->entrySeq;
        $now = date('Y-m-d H:i:s');
        $this->entries[$id] = [
            'id'             => $id,
            'user_id'        => $userId,
            'entry_type'     => $entryType,
            'template_id'    => $templateId,
            'schema_version' => $schemaVersion,
            'encrypted_data' => $encryptedData,
            'deleted_at'     => null,
            'created_at'     => $now,
            'updated_at'     => $now,
        ];
        return $id;
    }

    public function updateEntry(int $userId, int $entryId, string $encryptedData, ?string $entryType = null, ?int $templateId = null): bool {
        $entry = $this->entries[$entryId] ?? null;
        if (!$entry || $entry['user_id'] !== $userId || $entry['deleted_at'] !== null) {
            return false;
        }
        $this->entries[$entryId]['encrypted_data'] = $encryptedData;
        $this->entries[$entryId]['updated_at'] = date('Y-m-d H:i:s');
        if ($entryType !== null) {
            if (!in_array($entryType, self::VALID_ENTRY_TYPES, true)) {
                throw new InvalidArgumentException("Invalid entry type: '{$entryType}'.");
            }
            $this->entries[$entryId]['entry_type'] = $entryType;
        }
        if ($templateId !== null) {
            $this->entries[$entryId]['template_id'] = $templateId;
        }
        return true;
    }

    public function deleteEntry(int $userId, int $entryId): bool {
        $entry = $this->entries[$entryId] ?? null;
        if (!$entry || $entry['user_id'] !== $userId || $entry['deleted_at'] !== null) {
            return false;
        }
        $this->entries[$entryId]['deleted_at'] = date('Y-m-d H:i:s');
        return true;
    }

    // =========================================================================
    // User Vault Keys
    // =========================================================================

    public function getVaultKeys(int $userId): ?array {
        return $this->vaultKeys[$userId] ?? null;
    }

    public function setVaultKeys(int $userId, array $keyData): bool {
        $allowedCols = [
            'vault_key_salt', 'encrypted_dek', 'recovery_key_salt',
            'encrypted_dek_recovery', 'recovery_key_encrypted',
            'public_key', 'encrypted_private_key', 'must_reset_vault_key',
        ];
        $filtered = array_intersect_key($keyData, array_flip($allowedCols));
        if (empty($filtered)) {
            return false;
        }

        if (isset($this->vaultKeys[$userId])) {
            $this->vaultKeys[$userId] = array_merge($this->vaultKeys[$userId], $filtered);
        } else {
            $this->vaultKeys[$userId] = $filtered;
        }
        return true;
    }

    // =========================================================================
    // Preferences (KV Store)
    // =========================================================================

    public function getPreferences(int $userId): array {
        return $this->preferences[$userId] ?? [];
    }

    public function setPreference(int $userId, string $key, string $value): bool {
        if (!isset($this->preferences[$userId])) {
            $this->preferences[$userId] = [];
        }
        $this->preferences[$userId][$key] = $value;
        return true;
    }

    // =========================================================================
    // Sharing
    // =========================================================================

    public function getSharedByMe(int $userId): array {
        $results = array_filter($this->sharedItems, function ($s) use ($userId) {
            return $s['sender_id'] === $userId;
        });

        usort($results, function ($a, $b) {
            return strcmp($b['created_at'], $a['created_at']);
        });

        return array_map(function ($s) {
            return [
                'id'                   => $s['id'],
                'recipient_identifier' => $s['recipient_identifier'],
                'recipient_username'   => null,
                'source_entry_id'      => $s['source_entry_id'],
                'entry_type'           => $s['entry_type'],
                'is_ghost'             => (bool)$s['is_ghost'],
                'template'             => $this->findTemplate($s['template_id'] ?? null),
                'created_at'           => $s['created_at'],
                'updated_at'           => $s['updated_at'],
            ];
        }, array_values($results));
    }

    public function getSharedWithMe(int $userId): array {
        $results = array_filter($this->sharedItems, function ($s) use ($userId) {
            return $s['recipient_id'] === $userId;
        });

        usort($results, function ($a, $b) {
            return strcmp($b['created_at'], $a['created_at']);
        });

        return array_map(function ($s) {
            return [
                'id'              => $s['id'],
                'sender_username' => null,
                'entry_type'      => $s['entry_type'],
                'encrypted_data'  => $s['encrypted_data'],
                'is_ghost'        => (bool)$s['is_ghost'],
                'template'        => $this->findTemplate($s['template_id'] ?? null),
                'created_at'      => $s['created_at'],
                'updated_at'      => $s['updated_at'],
            ];
        }, array_values($results));
    }

    public function createShare(array $shareData): int {
        $id = ++$this->shareSeq;
        $now = date('Y-m-d H:i:s');
        $this->sharedItems[$id] = [
            'id'                   => $id,
            'sender_id'            => $shareData['sender_id'],
            'recipient_identifier' => $shareData['recipient_identifier'],
            'recipient_id'         => $shareData['recipient_id'] ?? null,
            'source_entry_id'      => $shareData['source_entry_id'],
            'entry_type'           => $shareData['entry_type'],
            'template_id'          => $shareData['template_id'] ?? null,
            'encrypted_data'       => $shareData['encrypted_data'],
            'is_ghost'             => $shareData['is_ghost'] ?? 0,
            'created_at'           => $now,
            'updated_at'           => $now,
        ];
        return $id;
    }

    public function updateShare(int $shareId, string $encryptedData): bool {
        if (!isset($this->sharedItems[$shareId])) {
            return false;
        }
        $this->sharedItems[$shareId]['encrypted_data'] = $encryptedData;
        $this->sharedItems[$shareId]['updated_at'] = date('Y-m-d H:i:s');
        return true;
    }

    public function deleteShare(int $senderId, int $shareId): bool {
        $share = $this->sharedItems[$shareId] ?? null;
        if (!$share || $share['sender_id'] !== $senderId) {
            return false;
        }
        unset($this->sharedItems[$shareId]);
        return true;
    }

    // =========================================================================
    // Snapshots
    // =========================================================================

    public function getSnapshots(int $userId, ?string $fromDate = null, ?string $toDate = null): array {
        $results = array_filter($this->snapshots, function ($s) use ($userId, $fromDate, $toDate) {
            if ($s['user_id'] !== $userId) return false;
            if ($fromDate !== null && $s['snapshot_date'] < $fromDate) return false;
            if ($toDate !== null && $s['snapshot_date'] > $toDate) return false;
            return true;
        });

        usort($results, function ($a, $b) {
            $cmp = strcmp($a['snapshot_date'], $b['snapshot_date']);
            return $cmp !== 0 ? $cmp : strcmp($a['snapshot_time'], $b['snapshot_time']);
        });

        return array_values($results);
    }

    public function createSnapshot(int $userId, string $date, string $encryptedData): int {
        // One snapshot per user per day — remove existing
        foreach ($this->snapshots as $sid => $s) {
            if ($s['user_id'] === $userId && $s['snapshot_date'] === $date) {
                $this->snapshotEntries = array_filter($this->snapshotEntries, fn($e) => $e['snapshot_id'] !== $sid);
                unset($this->snapshots[$sid]);
            }
        }

        $id = ++$this->snapshotSeq;
        $now = date('Y-m-d H:i:s');
        $this->snapshots[$id] = [
            'id'             => $id,
            'user_id'        => $userId,
            'snapshot_date'  => $date,
            'snapshot_time'  => $now,
            'encrypted_data' => $encryptedData,
        ];
        return $id;
    }

    private array $snapshotEntries = [];
    private int $snapshotEntrySeq = 0;

    public function createSnapshotWithEntries(int $userId, string $date, string $encryptedMeta, array $entries): int {
        // One snapshot per user per day — remove existing
        foreach ($this->snapshots as $sid => $s) {
            if ($s['user_id'] === $userId && $s['snapshot_date'] === $date) {
                $this->snapshotEntries = array_filter($this->snapshotEntries, fn($e) => $e['snapshot_id'] !== $sid);
                unset($this->snapshots[$sid]);
            }
        }

        $id = ++$this->snapshotSeq;
        $now = date('Y-m-d H:i:s');
        $this->snapshots[$id] = [
            'id'             => $id,
            'user_id'        => $userId,
            'snapshot_date'  => $date,
            'snapshot_time'  => $now,
            'encrypted_data' => $encryptedMeta,
        ];

        foreach ($entries as $entry) {
            $eid = ++$this->snapshotEntrySeq;
            $this->snapshotEntries[$eid] = [
                'id'             => $eid,
                'snapshot_id'    => $id,
                'entry_id'       => $entry['entry_id'] ?? null,
                'encrypted_data' => $entry['encrypted_data'],
            ];
        }

        return $id;
    }

    public function getSnapshotsWithEntries(int $userId, ?string $fromDate = null, ?string $toDate = null): array {
        $snapshots = $this->getSnapshots($userId, $fromDate, $toDate);

        foreach ($snapshots as &$s) {
            $s['entries'] = [];
            foreach ($this->snapshotEntries as $e) {
                if ($e['snapshot_id'] === $s['id']) {
                    $s['entries'][] = [
                        'entry_id'       => $e['entry_id'],
                        'encrypted_data' => $e['encrypted_data'],
                    ];
                }
            }
        }
        unset($s);

        return $snapshots;
    }

    // =========================================================================
    // Audit Log
    // =========================================================================

    public function logAction(int $userId, string $action, ?string $resourceType = null, ?int $resourceId = null, ?string $ipHash = null): void {
        // Respect user's audit_ip_mode preference
        $prefs = $this->getPreferences($userId);
        $ipMode = $prefs['audit_ip_mode'] ?? 'hashed';
        if ($ipMode === 'none') {
            $ipHash = null;
        }

        $id = ++$this->auditSeq;
        $this->auditLog[$id] = [
            'id'            => $id,
            'user_id'       => $userId,
            'action'        => $action,
            'resource_type' => $resourceType,
            'resource_id'   => $resourceId,
            'ip_hash'       => $ipHash,
            'created_at'    => date('Y-m-d H:i:s'),
        ];
    }

    public function getAuditLog(int $userId, ?string $fromDate = null, ?string $toDate = null): array {
        $results = array_filter($this->auditLog, function ($a) use ($userId, $fromDate, $toDate) {
            if ($a['user_id'] !== $userId) return false;
            if ($fromDate !== null && $a['created_at'] < $fromDate) return false;
            if ($toDate !== null && $a['created_at'] > $toDate . ' 23:59:59') return false;
            return true;
        });

        // Sort by created_at DESC
        usort($results, function ($a, $b) {
            return strcmp($b['created_at'], $a['created_at']);
        });

        return array_map(function ($a) {
            return [
                'id'            => $a['id'],
                'action'        => $a['action'],
                'resource_type' => $a['resource_type'],
                'resource_id'   => $a['resource_id'],
                'created_at'    => $a['created_at'],
            ];
        }, array_values($results));
    }

    // =========================================================================
    // Templates
    // =========================================================================

    public function getTemplates(int $userId): array {
        $results = array_filter($this->templates, function ($t) use ($userId) {
            if (!$t['is_active']) return false;
            return $t['owner_id'] === null || $t['owner_id'] === $userId;
        });

        usort($results, function ($a, $b) {
            $cmp = strcmp($a['template_key'], $b['template_key']);
            if ($cmp !== 0) return $cmp;
            $cmp = strcmp($a['country_code'] ?? '', $b['country_code'] ?? '');
            if ($cmp !== 0) return $cmp;
            return strcmp($a['subtype'] ?? '', $b['subtype'] ?? '');
        });

        return array_map(function ($t) {
            $t['is_global'] = $t['owner_id'] === null;
            if (is_string($t['fields'])) {
                $t['fields'] = json_decode($t['fields'], true) ?? [];
            }
            return $t;
        }, array_values($results));
    }

    public function createTemplate(int $userId, array $templateData): int {
        $id = ++$this->templateSeq;
        $now = date('Y-m-d H:i:s');
        $this->templates[$id] = [
            'id'                    => $id,
            'template_key'          => $templateData['template_key'],
            'owner_id'              => $userId,
            'name'                  => $templateData['name'],
            'icon'                  => $templateData['icon'] ?? null,
            'country_code'          => $templateData['country_code'] ?? null,
            'subtype'               => $templateData['subtype'] ?? null,
            'schema_version'        => $templateData['schema_version'] ?? 1,
            'fields'                => $templateData['fields'] ?? [],
            'is_active'             => 1,
            'promotion_requested'   => 0,
            'promotion_requested_at' => null,
            'created_at'            => $now,
            'updated_at'            => $now,
        ];
        return $id;
    }

    public function updateTemplate(int $userId, int $templateId, array $data): bool {
        $template = $this->templates[$templateId] ?? null;
        if (!$template || $template['owner_id'] !== $userId) {
            return false;
        }

        $allowedFields = ['name', 'icon', 'fields', 'is_active', 'promotion_requested', 'promotion_requested_at'];
        foreach ($data as $key => $value) {
            if (in_array($key, $allowedFields, true)) {
                $this->templates[$templateId][$key] = $value;
            }
        }
        $this->templates[$templateId]['updated_at'] = date('Y-m-d H:i:s');
        return true;
    }

    // =========================================================================
    // System Settings (global KV store)
    // =========================================================================

    private array $systemSettings = [];

    public function getSystemSetting(string $key): ?string {
        return $this->systemSettings[$key] ?? null;
    }

    public function getSystemSettings(): array {
        return $this->systemSettings;
    }

    public function setSystemSetting(string $key, string $value, ?int $userId = null): bool {
        $this->systemSettings[$key] = $value;
        return true;
    }

    // =========================================================================
    // Private Helpers
    // =========================================================================

    /**
     * Find a template by ID and return its inline object representation.
     */
    private function findTemplate(?int $templateId): ?array {
        if ($templateId === null || !isset($this->templates[$templateId])) {
            return null;
        }
        $t = $this->templates[$templateId];
        $fields = $t['fields'];
        if (is_string($fields)) {
            $fields = json_decode($fields, true) ?? [];
        }
        return [
            'name'   => $t['name'],
            'icon'   => $t['icon'] ?? null,
            'key'    => $t['template_key'] ?? null,
            'fields' => $fields,
        ];
    }
}
