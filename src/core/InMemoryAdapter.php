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

    private array $accountTypes = [];
    private array $assetTypes = [];
    private array $countries = [];
    private array $currencies = [];
    private array $exchanges = [];
    private array $currencyRateHistory = [];
    private array $tickerPrices = [];
    private array $priceHistory = [];
    private array $accountDetailTemplates = [];
    private array $rateLimits = [];
    private array $inviteRequests = [];
    private array $invitations = [];
    private array $users = [];
    private array $webauthnChallenges = [];
    private array $webauthnCredentials = [];
    private array $plaidItems = [];

    /** @var array<string, int> Auto-increment counters per table */
    private int $entrySeq = 0;
    private int $shareSeq = 0;
    private int $snapshotSeq = 0;
    private int $auditSeq = 0;
    private int $templateSeq = 0;
    private int $accountTypeSeq = 0;
    private int $assetTypeSeq = 0;
    private int $countrySeq = 0;
    private int $currencySeq = 0;
    private int $exchangeSeq = 0;
    private int $accountDetailTemplateSeq = 0;
    private int $invitationSeq = 0;
    private int $inviteRequestSeq = 0;
    private int $userSeq = 0;
    private int $webauthnChallengeSeq = 0;
    private int $webauthnCredentialSeq = 0;

    // =========================================================================
    // Transaction Control
    // =========================================================================

    private bool $inTransaction = false;

    public function beginTransaction(): void {
        $this->inTransaction = true;
    }

    public function commit(): void {
        $this->inTransaction = false;
    }

    public function rollBack(): void {
        $this->inTransaction = false;
    }

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

    public function getEntryCounts(int $userId): array {
        $counts = [];
        foreach ($this->entries as $e) {
            if ($e['user_id'] !== $userId || $e['deleted_at'] !== null) continue;
            $type = $e['entry_type'];
            $counts[$type] = ($counts[$type] ?? 0) + 1;
        }
        return $counts;
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

    public function getSoftDeletedEntries(int $userId): array {
        $cutoff = date('Y-m-d H:i:s', strtotime('-1 day'));
        $results = [];
        foreach ($this->entries as $e) {
            if ($e['user_id'] !== $userId) continue;
            if ($e['deleted_at'] === null) continue;
            if ($e['deleted_at'] < $cutoff) continue;

            // LEFT JOIN entry_templates — return flat columns matching MariaDbAdapter
            $templateName = null;
            $templateIcon = null;
            $templateFields = null;
            if ($e['template_id'] !== null && isset($this->templates[$e['template_id']])) {
                $t = $this->templates[$e['template_id']];
                $templateName = $t['name'] ?? null;
                $templateIcon = $t['icon'] ?? null;
                $templateFields = $t['fields'] ?? null;
                if (is_array($templateFields)) {
                    $templateFields = json_encode($templateFields);
                }
            }

            $results[] = [
                'id'              => $e['id'],
                'entry_type'      => $e['entry_type'],
                'template_id'     => $e['template_id'],
                'encrypted_data'  => $e['encrypted_data'],
                'deleted_at'      => $e['deleted_at'],
                'created_at'      => $e['created_at'],
                'updated_at'      => $e['updated_at'],
                'template_name'   => $templateName,
                'template_icon'   => $templateIcon,
                'template_fields' => $templateFields,
            ];
        }

        // ORDER BY deleted_at DESC
        usort($results, function ($a, $b) {
            return strcmp($b['deleted_at'], $a['deleted_at']);
        });

        return $results;
    }

    public function restoreDeletedEntry(int $userId, int $entryId): bool {
        $entry = $this->entries[$entryId] ?? null;
        if (!$entry || $entry['user_id'] !== $userId || $entry['deleted_at'] === null) {
            return false;
        }
        $this->entries[$entryId]['deleted_at'] = null;
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
            'admin_action_message',
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
                'recipient_id'         => $s['recipient_id'] ?? null,
                'recipient_username'   => null,
                'source_entry_id'      => $s['source_entry_id'],
                'entry_type'           => $s['entry_type'],
                'source_type'          => $s['source_type'] ?? 'entry',
                'status'               => ((int)($s['recipient_id'] ?? 0) === 0 || $s['recipient_id'] === null) ? 'pending' : 'active',
                'sync_mode'            => $s['sync_mode'] ?? 'snapshot',
                'label'                => $s['label'] ?? null,
                'expires_at'           => $s['expires_at'] ?? null,
                'template'             => $this->findTemplate($s['template_id'] ?? null),
                'created_at'           => $s['created_at'],
                'updated_at'           => $s['updated_at'],
            ];
        }, array_values($results));
    }

    public function getSharedWithMe(int $userId): array {
        $now = date('Y-m-d H:i:s');
        $results = array_filter($this->sharedItems, function ($s) use ($userId, $now) {
            if ($s['recipient_id'] !== $userId) return false;
            // Filter expired shares
            if (!empty($s['expires_at']) && $s['expires_at'] <= $now) return false;
            return true;
        });

        usort($results, function ($a, $b) {
            return strcmp($b['created_at'], $a['created_at']);
        });

        return array_map(function ($s) {
            return [
                'id'              => $s['id'],
                'source_entry_id' => $s['source_entry_id'],
                'sender_username' => null,
                'entry_type'      => $s['entry_type'],
                'source_type'     => $s['source_type'] ?? 'entry',
                'encrypted_data'  => $s['encrypted_data'],
                'status'          => ((int)($s['recipient_id'] ?? 0) === 0 || $s['recipient_id'] === null) ? 'pending' : 'active',
                'sync_mode'       => $s['sync_mode'] ?? 'snapshot',
                'label'           => $s['label'] ?? null,
                'expires_at'      => $s['expires_at'] ?? null,
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
            'source_type'          => $shareData['source_type'] ?? 'entry',
            'template_id'          => $shareData['template_id'] ?? null,
            'encrypted_data'       => $shareData['encrypted_data'],
            'sync_mode'            => $shareData['sync_mode'] ?? 'snapshot',
            'label'                => $shareData['label'] ?? null,
            'expires_at'           => $shareData['expires_at'] ?? null,
            'created_at'           => $now,
            'updated_at'           => $now,
        ];
        return $id;
    }

    public function upsertShare(array $shareData): int {
        // Check for existing share with same (sender, entry, recipient)
        foreach ($this->sharedItems as $id => $item) {
            if ($item['sender_id'] === $shareData['sender_id']
                && $item['source_entry_id'] === $shareData['source_entry_id']
                && $item['recipient_id'] === $shareData['recipient_id']) {
                // Update existing — mirror MariaDB ON DUPLICATE KEY UPDATE VALUES() behavior
                $this->sharedItems[$id]['encrypted_data'] = $shareData['encrypted_data'];
                $this->sharedItems[$id]['sync_mode'] = $shareData['sync_mode'] ?? 'snapshot';
                $this->sharedItems[$id]['source_type'] = $shareData['source_type'] ?? 'entry';
                $this->sharedItems[$id]['label'] = $shareData['label'] ?? null;
                $this->sharedItems[$id]['expires_at'] = $shareData['expires_at'] ?? null;
                $this->sharedItems[$id]['updated_at'] = date('Y-m-d H:i:s');
                return $id;
            }
        }
        // No existing — create new
        return $this->createShare($shareData);
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

    public function getRecipientWithVaultKey(string $identifier): ?array {
        // Simulate: SELECT u.id, uvk.public_key FROM users u LEFT JOIN user_vault_keys uvk ...
        foreach ($this->users as $user) {
            if (($user['username'] ?? '') === $identifier || ($user['email'] ?? '') === $identifier) {
                // Filter: is_active = 1 AND role != 'ghost'
                if (($user['is_active'] ?? 1) != 1) continue;
                if (($user['role'] ?? 'user') === 'ghost') continue;

                // LEFT JOIN user_vault_keys
                $vaultKey = $this->vaultKeys[$user['id']] ?? null;
                return [
                    'id'         => $user['id'],
                    'public_key' => $vaultKey ? ($vaultKey['public_key'] ?? null) : null,
                ];
            }
        }
        return null;
    }

    public function getShareByKey(int $senderId, int $sourceEntryId, int $recipientId): ?array {
        foreach ($this->sharedItems as $item) {
            if ($item['sender_id'] === $senderId
                && $item['source_entry_id'] === $sourceEntryId
                && $item['recipient_id'] === $recipientId) {
                return ['id' => $item['id']];
            }
        }
        return null;
    }

    public function getSharesForRevoke(int $senderId, ?int $sourceEntryId, ?string $sourceType, ?int $recipientId = null): array {
        $results = [];
        foreach ($this->sharedItems as $item) {
            if ($item['sender_id'] !== $senderId) continue;

            if ($sourceEntryId === null) {
                // Portfolio: NULL-safe matching
                if ($item['source_entry_id'] !== null) continue;
                if (($item['source_type'] ?? 'entry') !== ($sourceType ?? 'portfolio')) continue;
            } else {
                // Entry-based
                if ($item['source_entry_id'] !== $sourceEntryId) continue;
            }

            if ($recipientId !== null && $item['recipient_id'] !== $recipientId) continue;

            $results[] = ['id' => $item['id']];
        }
        return $results;
    }

    public function getShareCountForEntry(int $senderId, int $entryId): int {
        $count = 0;
        foreach ($this->sharedItems as $item) {
            if ($item['source_entry_id'] === $entryId && $item['sender_id'] === $senderId) {
                $count++;
            }
        }
        return $count;
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

    public function updateSnapshotEntries(int $userId, int $snapshotId, array $entries): int {
        // Verify snapshot belongs to user
        if (!isset($this->snapshots[$snapshotId]) || $this->snapshots[$snapshotId]['user_id'] !== $userId) {
            throw new \RuntimeException('Snapshot not found or access denied.');
        }

        $updated = 0;
        foreach ($entries as $entry) {
            foreach ($this->snapshotEntries as &$se) {
                if ($se['snapshot_id'] === $snapshotId && $se['entry_id'] === ($entry['entry_id'] ?? null)) {
                    $se['encrypted_data'] = $entry['encrypted_data'];
                    $updated++;
                }
            }
            unset($se);
        }

        return $updated;
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

    public function getSnapshotsWithEntriesPaginated(int $userId, ?string $before = null, int $limit = 50): array {
        $all = $this->getSnapshotsWithEntries($userId);

        // Sort descending by date
        usort($all, fn($a, $b) => strcmp($b['snapshot_date'], $a['snapshot_date']));

        if ($before !== null) {
            $all = array_values(array_filter($all, fn($s) => $s['snapshot_date'] < $before));
        }

        $hasMore = count($all) > $limit;
        $page = array_slice($all, 0, $limit);

        // Reverse to chronological order
        $page = array_reverse($page);

        return [
            'snapshots'   => $page,
            'has_more'    => $hasMore,
            'next_cursor' => $hasMore ? $page[0]['snapshot_date'] : null,
        ];
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
    // Templates Admin
    // =========================================================================

    public function updateGlobalTemplate(int $templateId, array $data): bool {
        $template = $this->templates[$templateId] ?? null;
        if (!$template || $template['owner_id'] !== null) {
            return false;
        }

        $allowed = ['name', 'icon', 'fields', 'is_active'];
        foreach ($data as $k => $v) {
            if (in_array($k, $allowed, true)) {
                $this->templates[$templateId][$k] = $v;
            }
        }
        $this->templates[$templateId]['updated_at'] = date('Y-m-d H:i:s');
        return true;
    }

    public function relinkEntries(int $userId, int $oldTemplateId, int $newTemplateId): int {
        $count = 0;
        foreach ($this->entries as &$entry) {
            if ($entry['template_id'] === $oldTemplateId && $entry['user_id'] === $userId) {
                $entry['template_id'] = $newTemplateId;
                $count++;
            }
        }
        unset($entry);
        return $count;
    }

    public function getTemplateOwner(int $templateId): ?array {
        $template = $this->templates[$templateId] ?? null;
        if (!$template) {
            return null;
        }
        return ['owner_id' => $template['owner_id']];
    }

    public function setPromotionRequested(int $templateId): void {
        if (isset($this->templates[$templateId])) {
            $this->templates[$templateId]['promotion_requested'] = 1;
            $this->templates[$templateId]['promotion_requested_at'] = date('Y-m-d H:i:s');
        }
    }

    public function getTemplateForPromotion(int $templateId): ?array {
        $template = $this->templates[$templateId] ?? null;
        if (!$template || !$template['promotion_requested']) {
            return null;
        }
        return $template;
    }

    public function createGlobalTemplate(array $templateData): int {
        $id = ++$this->templateSeq;
        $now = date('Y-m-d H:i:s');
        $this->templates[$id] = [
            'id'                    => $id,
            'template_key'          => $templateData['template_key'],
            'owner_id'              => null,
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

    public function clearPromotionRequest(int $templateId): void {
        if (isset($this->templates[$templateId])) {
            $this->templates[$templateId]['promotion_requested'] = 0;
            $this->templates[$templateId]['promotion_requested_at'] = null;
        }
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

    public function getSystemSettingsEnriched(): array {
        $result = [];
        foreach ($this->systemSettings as $key => $value) {
            $result[$key] = [
                'value'       => $value,
                'type'        => 'config',
                'category'    => 'general',
                'description' => $key,
                'options'     => null,
            ];
        }
        return $result;
    }

    public function setSystemSetting(string $key, string $value, ?int $userId = null): bool {
        $this->systemSettings[$key] = $value;
        return true;
    }

    // =========================================================================
    // Account Types
    // =========================================================================

    public function getAccountTypes(): array {
        $results = array_values($this->accountTypes);
        usort($results, function ($a, $b) {
            $cmp = ($b['is_system'] ?? 0) <=> ($a['is_system'] ?? 0);
            return $cmp !== 0 ? $cmp : strcmp($a['name'], $b['name']);
        });
        return $results;
    }

    public function createAccountType(array $data): int {
        $id = ++$this->accountTypeSeq;
        $this->accountTypes[$id] = array_merge($data, [
            'id' => $id,
            'is_system' => 0,
        ]);
        return $id;
    }

    public function getAccountType(int $id): ?array {
        return $this->accountTypes[$id] ?? null;
    }

    public function updateAccountType(int $id, array $fields): void {
        if (isset($this->accountTypes[$id])) {
            $this->accountTypes[$id] = array_merge($this->accountTypes[$id], $fields);
        }
    }

    public function deleteAccountType(int $id): void {
        unset($this->accountTypes[$id]);
    }

    public function getAccountTypeUsageCount(int $id): int {
        // In-memory: no accounts table — always return 0
        return 0;
    }

    // =========================================================================
    // Asset Types
    // =========================================================================

    public function getAssetTypes(): array {
        $results = array_values($this->assetTypes);
        usort($results, function ($a, $b) {
            $cmp = ($b['is_system'] ?? 0) <=> ($a['is_system'] ?? 0);
            return $cmp !== 0 ? $cmp : strcmp($a['name'], $b['name']);
        });
        return $results;
    }

    public function createAssetType(array $data): int {
        $id = ++$this->assetTypeSeq;
        $this->assetTypes[$id] = array_merge($data, [
            'id' => $id,
            'is_system' => 0,
        ]);
        return $id;
    }

    public function getAssetType(int $id): ?array {
        return $this->assetTypes[$id] ?? null;
    }

    public function updateAssetType(int $id, array $fields): void {
        if (isset($this->assetTypes[$id])) {
            $this->assetTypes[$id] = array_merge($this->assetTypes[$id], $fields);
        }
    }

    public function deleteAssetType(int $id): void {
        unset($this->assetTypes[$id]);
    }

    public function getAssetTypeUsageCount(int $id): int {
        // In-memory: no assets table — always return 0
        return 0;
    }

    // =========================================================================
    // Countries
    // =========================================================================

    public function getCountries(bool $includeInactive = false): array {
        $results = array_filter($this->countries, function ($c) use ($includeInactive) {
            if ($includeInactive) return true;
            return ($c['is_active'] ?? 1) == 1;
        });

        // LEFT JOIN currencies for default_currency_code and default_currency_symbol
        $results = array_map(function ($c) {
            $currencyCode = null;
            $currencySymbol = null;
            if (!empty($c['default_currency_id'])) {
                $cur = $this->currencies[$c['default_currency_id']] ?? null;
                if ($cur) {
                    $currencyCode = $cur['code'] ?? null;
                    $currencySymbol = $cur['symbol'] ?? null;
                }
            }
            $c['default_currency_code'] = $currencyCode;
            $c['default_currency_symbol'] = $currencySymbol;
            return $c;
        }, $results);

        usort($results, function ($a, $b) {
            $cmp = ($a['display_order'] ?? 0) <=> ($b['display_order'] ?? 0);
            return $cmp !== 0 ? $cmp : strcmp($a['name'], $b['name']);
        });
        return array_values($results);
    }

    public function createCountry(array $data): int {
        $id = ++$this->countrySeq;
        $this->countries[$id] = array_merge($data, ['id' => $id]);
        return $id;
    }

    public function getCountry(int $id): ?array {
        return $this->countries[$id] ?? null;
    }

    public function updateCountry(int $id, array $fields): void {
        if (isset($this->countries[$id])) {
            $this->countries[$id] = array_merge($this->countries[$id], $fields);
        }
    }

    public function deleteCountry(int $id): void {
        unset($this->countries[$id]);
    }

    public function getCountryUsageCount(int $id): int {
        // In-memory: no accounts table — always return 0
        return 0;
    }

    // =========================================================================
    // Currencies
    // =========================================================================

    public function getCurrencies(bool $includeInactive = false): array {
        $results = array_filter($this->currencies, function ($c) use ($includeInactive) {
            if ($includeInactive) return true;
            return ($c['is_active'] ?? 1) == 1;
        });

        usort($results, function ($a, $b) {
            $cmp = ($a['display_order'] ?? 0) <=> ($b['display_order'] ?? 0);
            return $cmp !== 0 ? $cmp : strcmp($a['name'], $b['name']);
        });
        return array_values($results);
    }

    public function createCurrency(array $data): int {
        $id = ++$this->currencySeq;
        $this->currencies[$id] = array_merge($data, ['id' => $id]);
        return $id;
    }

    public function getCurrency(int $id): ?array {
        return $this->currencies[$id] ?? null;
    }

    public function updateCurrency(int $id, array $fields): void {
        if (isset($this->currencies[$id])) {
            $this->currencies[$id] = array_merge($this->currencies[$id], $fields);
        }
    }

    // =========================================================================
    // Exchanges
    // =========================================================================

    public function getExchanges(): array {
        $results = array_map(function ($e) {
            // LEFT JOIN countries for country_name
            $countryName = null;
            foreach ($this->countries as $c) {
                if (($c['code'] ?? null) === ($e['country_code'] ?? null)) {
                    $countryName = $c['name'];
                    break;
                }
            }
            $e['country_name'] = $countryName;
            return $e;
        }, array_values($this->exchanges));

        usort($results, function ($a, $b) {
            $cmp = strcmp($a['country_code'] ?? '', $b['country_code'] ?? '');
            if ($cmp !== 0) return $cmp;
            $cmp = ($a['display_order'] ?? 0) <=> ($b['display_order'] ?? 0);
            if ($cmp !== 0) return $cmp;
            return strcmp($a['name'] ?? '', $b['name'] ?? '');
        });
        return $results;
    }

    public function createExchange(array $data): int {
        $id = ++$this->exchangeSeq;
        $this->exchanges[$id] = array_merge($data, ['id' => $id]);
        return $id;
    }

    public function getExchange(int $id): ?array {
        return $this->exchanges[$id] ?? null;
    }

    public function updateExchange(int $id, array $fields): void {
        if (isset($this->exchanges[$id])) {
            $this->exchanges[$id] = array_merge($this->exchanges[$id], $fields);
        }
    }

    public function deleteExchange(int $id): bool {
        if (!isset($this->exchanges[$id])) {
            return false;
        }
        unset($this->exchanges[$id]);
        return true;
    }

    // =========================================================================
    // Prices
    // =========================================================================

    public function getCachedPrices(array $tickers, int $ttlSeconds): array {
        if (empty($tickers)) {
            return [];
        }
        $cutoff = gmdate('Y-m-d H:i:s', time() - $ttlSeconds);
        $results = [];
        foreach ($this->tickerPrices as $row) {
            if (in_array($row['ticker'], $tickers, true) && $row['fetched_at'] > $cutoff) {
                $results[] = [
                    'ticker'     => $row['ticker'],
                    'exchange'   => $row['exchange'],
                    'price'      => $row['price'],
                    'currency'   => $row['currency'],
                    'name'       => $row['name'],
                    'fetched_at' => $row['fetched_at'],
                ];
            }
        }
        return $results;
    }

    public function upsertPrice(string $ticker, string $exchange, float $price, string $currency, string $name): void {
        $now = gmdate('Y-m-d H:i:s');
        // ON DUPLICATE KEY UPDATE on ticker
        foreach ($this->tickerPrices as &$row) {
            if ($row['ticker'] === $ticker) {
                $row['exchange']   = $exchange;
                $row['price']      = $price;
                $row['currency']   = $currency;
                $row['name']       = $name;
                $row['fetched_at'] = $now;
                return;
            }
        }
        unset($row);
        // Insert new
        $this->tickerPrices[] = [
            'ticker'     => $ticker,
            'exchange'   => $exchange,
            'price'      => $price,
            'currency'   => $currency,
            'name'       => $name,
            'fetched_at' => $now,
        ];
    }

    public function addPriceHistory(string $ticker, string $exchange, float $price, string $currency): void {
        $today = gmdate('Y-m-d');
        // ON DUPLICATE KEY UPDATE on (ticker, recorded_at)
        foreach ($this->priceHistory as &$row) {
            if ($row['ticker'] === $ticker && $row['recorded_at'] === $today) {
                $row['price']    = $price;
                $row['exchange'] = $exchange;
                return;
            }
        }
        unset($row);
        // Insert new
        $this->priceHistory[] = [
            'ticker'      => $ticker,
            'exchange'    => $exchange,
            'price'       => $price,
            'currency'    => $currency,
            'recorded_at' => $today,
        ];
    }

    public function getAllCachedPrices(): array {
        $results = $this->tickerPrices;
        usort($results, function ($a, $b) {
            return strcmp($b['fetched_at'], $a['fetched_at']);
        });
        return $results;
    }

    public function clearPriceCache(): void {
        $this->tickerPrices = [];
    }

    // =========================================================================
    // Historical Rates
    // =========================================================================

    public function getHistoricalRates(string $date): array {
        $results = [];
        foreach ($this->currencyRateHistory as $entry) {
            if ($entry['recorded_at'] === $date) {
                // JOIN currencies for code
                $cur = $this->currencies[$entry['currency_id']] ?? null;
                $code = $cur ? ($cur['code'] ?? null) : null;
                $results[] = [
                    'code'          => $code,
                    'rate_to_base'  => $entry['rate_to_base'],
                    'base_currency' => $entry['base_currency'],
                ];
            }
        }
        return $results;
    }

    // =========================================================================
    // Exchange Rates
    // =========================================================================

    public function getLastCurrencyUpdate(): ?string {
        $max = null;
        foreach ($this->currencies as $c) {
            $lastUpdated = $c['last_updated'] ?? null;
            if ($lastUpdated !== null && ($max === null || $lastUpdated > $max)) {
                $max = $lastUpdated;
            }
        }
        return $max;
    }

    public function getAllCurrenciesForUpdate(): array {
        return array_map(function ($c) {
            return ['id' => $c['id'], 'code' => $c['code']];
        }, array_values($this->currencies));
    }

    public function updateExchangeRate(int $currencyId, float $rate): void {
        if (isset($this->currencies[$currencyId])) {
            $this->currencies[$currencyId]['exchange_rate_to_base'] = $rate;
            $this->currencies[$currencyId]['last_updated'] = gmdate('Y-m-d H:i:s');
        }
    }

    public function addCurrencyRateHistory(int $currencyId, float $rate, string $baseCurrency): void {
        $today = gmdate('Y-m-d');
        // ON DUPLICATE KEY UPDATE on (currency_id, recorded_at)
        foreach ($this->currencyRateHistory as &$entry) {
            if ($entry['currency_id'] === $currencyId && $entry['recorded_at'] === $today) {
                $entry['rate_to_base'] = $rate;
                $entry['base_currency'] = $baseCurrency;
                return;
            }
        }
        unset($entry);
        // Insert new
        $this->currencyRateHistory[] = [
            'currency_id'   => $currencyId,
            'rate_to_base'  => $rate,
            'base_currency' => $baseCurrency,
            'recorded_at'   => $today,
        ];
    }

    // =========================================================================
    // Account Detail Templates
    // =========================================================================

    public function getAccountDetailTemplates(int $userId): array {
        $results = array_filter($this->accountDetailTemplates, function ($row) use ($userId) {
            return $row['user_id'] === $userId || ($row['is_global'] ?? 0) == 1;
        });

        // ORDER BY is_global ASC, updated_at DESC
        usort($results, function ($a, $b) {
            $cmp = ($a['is_global'] ?? 0) <=> ($b['is_global'] ?? 0);
            if ($cmp !== 0) return $cmp;
            return strcmp($b['updated_at'], $a['updated_at']);
        });

        return array_values($results);
    }

    public function upsertAccountDetailTemplate(int $userId, array $data): int {
        $accountTypeId = $data['account_type_id'];
        $subtype       = $data['subtype'];
        $countryId     = $data['country_id'];
        $fieldKeysJson = $data['field_keys'];
        $scope         = $data['scope'] ?? 'personal';

        if ($scope === 'global') {
            // Check if a global row already exists for this combo
            foreach ($this->accountDetailTemplates as $id => $row) {
                if ($row['user_id'] === 0
                    && $row['account_type_id'] === $accountTypeId
                    && $row['subtype'] === $subtype
                    && $row['country_id'] === $countryId
                    && ($row['is_global'] ?? 0) == 1
                ) {
                    // Update existing global template
                    $this->accountDetailTemplates[$id]['field_keys'] = $fieldKeysJson;
                    $this->accountDetailTemplates[$id]['updated_at'] = date('Y-m-d H:i:s');
                    return $id;
                }
            }
            // New global template
            $id = ++$this->accountDetailTemplateSeq;
            $now = date('Y-m-d H:i:s');
            $this->accountDetailTemplates[$id] = [
                'id'              => $id,
                'user_id'         => 0,
                'account_type_id' => $accountTypeId,
                'subtype'         => $subtype,
                'country_id'      => $countryId,
                'is_global'       => 1,
                'field_keys'      => $fieldKeysJson,
                'created_at'      => $now,
                'updated_at'      => $now,
            ];
            return $id;
        } else {
            // Personal template: check for existing (user_id, account_type_id, subtype, country_id)
            foreach ($this->accountDetailTemplates as $id => $row) {
                if ($row['user_id'] === $userId
                    && $row['account_type_id'] === $accountTypeId
                    && $row['subtype'] === $subtype
                    && $row['country_id'] === $countryId
                    && ($row['is_global'] ?? 0) == 0
                ) {
                    // ON DUPLICATE KEY UPDATE
                    $this->accountDetailTemplates[$id]['field_keys'] = $fieldKeysJson;
                    $this->accountDetailTemplates[$id]['updated_at'] = date('Y-m-d H:i:s');
                    return $id;
                }
            }
            // Insert new personal template
            $id = ++$this->accountDetailTemplateSeq;
            $now = date('Y-m-d H:i:s');
            $this->accountDetailTemplates[$id] = [
                'id'              => $id,
                'user_id'         => $userId,
                'account_type_id' => $accountTypeId,
                'subtype'         => $subtype,
                'country_id'      => $countryId,
                'is_global'       => 0,
                'field_keys'      => $fieldKeysJson,
                'created_at'      => $now,
                'updated_at'      => $now,
            ];
            return $id;
        }
    }

    public function getAccountDetailTemplate(int $id): ?array {
        $row = $this->accountDetailTemplates[$id] ?? null;
        if (!$row) {
            return null;
        }
        return [
            'id'        => $row['id'],
            'user_id'   => $row['user_id'],
            'is_global' => $row['is_global'] ?? 0,
        ];
    }

    public function deleteAccountDetailTemplate(int $id): void {
        unset($this->accountDetailTemplates[$id]);
    }

    // =========================================================================
    // User Management
    // =========================================================================

    public function getActiveUsersSimple(int $excludeUserId): array {
        $results = [];
        foreach ($this->users as $user) {
            if (($user['is_active'] ?? 1) == 1 && $user['id'] !== $excludeUserId) {
                $results[] = [
                    'id'       => $user['id'],
                    'username' => $user['username'],
                ];
            }
        }
        usort($results, function ($a, $b) {
            return strcmp($a['username'], $b['username']);
        });
        return $results;
    }

    public function getAllUsersWithVaultKeyStatus(): array {
        $results = [];
        foreach ($this->users as $user) {
            // Simulate LEFT JOIN user_vault_keys with COALESCE
            $vaultKey = $this->vaultKeys[$user['id']] ?? null;
            $results[] = [
                'id'                   => $user['id'],
                'username'             => $user['username'],
                'display_name'         => $user['display_name'] ?? null,
                'email'                => $user['email'] ?? null,
                'role'                 => $user['role'] ?? 'user',
                'is_active'            => $user['is_active'] ?? 1,
                'created_at'           => $user['created_at'] ?? null,
                'has_vault_key'        => $vaultKey !== null ? 1 : 0,
                'must_reset_vault_key' => $vaultKey !== null ? ($vaultKey['must_reset_vault_key'] ?? 0) : 0,
            ];
        }
        // ORDER BY id
        usort($results, function ($a, $b) {
            return $a['id'] <=> $b['id'];
        });
        return $results;
    }

    public function createUserByAdmin(array $data): int {
        // Check for duplicate username or email (simulate UNIQUE constraint)
        foreach ($this->users as $user) {
            if (($user['username'] ?? '') === $data['username']
                || ($user['email'] ?? '') === $data['email']) {
                $e = new \PDOException('Duplicate entry', 23000);
                $e->errorInfo = ['23000', 1062, 'Duplicate entry'];
                throw $e;
            }
        }

        $id = ++$this->userSeq;
        $now = date('Y-m-d H:i:s');
        $this->users[$id] = [
            'id'                  => $id,
            'username'            => $data['username'],
            'display_name'        => $data['display_name'] ?? null,
            'email'               => $data['email'],
            'password_hash'       => $data['password_hash'],
            'role'                => $data['role'] ?? 'user',
            'is_active'           => 1,
            'email_verified'      => 1,
            'must_reset_password' => 1,
            'created_at'          => $now,
        ];
        return $id;
    }

    private const USER_UPDATE_COLUMNS = [
        'username', 'email', 'password_hash', 'role', 'is_active', 'must_reset_password',
    ];

    public function updateUser(int $id, array $fields): void {
        if (!isset($this->users[$id])) {
            return;
        }

        $filtered = array_intersect_key($fields, array_flip(self::USER_UPDATE_COLUMNS));
        if (empty($filtered)) {
            return;
        }

        // Check for duplicate username or email (simulate UNIQUE constraint)
        foreach ($this->users as $uid => $user) {
            if ($uid === $id) continue;
            if (isset($filtered['username']) && ($user['username'] ?? '') === $filtered['username']) {
                $e = new \PDOException('Duplicate entry', 23000);
                $e->errorInfo = ['23000', 1062, 'Duplicate entry'];
                throw $e;
            }
            if (isset($filtered['email']) && ($user['email'] ?? '') === $filtered['email']) {
                $e = new \PDOException('Duplicate entry', 23000);
                $e->errorInfo = ['23000', 1062, 'Duplicate entry'];
                throw $e;
            }
        }

        $this->users[$id] = array_merge($this->users[$id], $filtered);
    }

    public function deleteUser(int $id): bool {
        if (!isset($this->users[$id])) {
            return false;
        }
        unset($this->users[$id]);
        return true;
    }

    // =========================================================================
    // Dashboard
    // =========================================================================

    public function getSharedWithMeCount(int $userId): int {
        $count = 0;
        foreach ($this->sharedItems as $s) {
            if ($s['recipient_id'] === $userId) {
                $count++;
            }
        }
        return $count;
    }

    public function getLastAuditEvent(int $userId, string $action): ?string {
        $max = null;
        foreach ($this->auditLog as $a) {
            if ($a['user_id'] === $userId && $a['action'] === $action) {
                if ($max === null || $a['created_at'] > $max) {
                    $max = $a['created_at'];
                }
            }
        }
        return $max;
    }

    // =========================================================================
    // Sync
    // =========================================================================

    public function getMaxEntryUpdatedAt(int $userId): ?string {
        $max = null;
        foreach ($this->entries as $e) {
            if ($e['user_id'] === $userId) {
                if ($max === null || $e['updated_at'] > $max) {
                    $max = $e['updated_at'];
                }
            }
        }
        return $max;
    }

    public function getMaxCountryUpdatedAt(): ?string {
        $max = null;
        foreach ($this->countries as $c) {
            $updatedAt = $c['updated_at'] ?? null;
            if ($updatedAt !== null && ($max === null || $updatedAt > $max)) {
                $max = $updatedAt;
            }
        }
        return $max;
    }

    public function getMaxTemplateUpdatedAt(int $userId): ?string {
        $max = null;
        foreach ($this->templates as $t) {
            if ($t['owner_id'] === null || $t['owner_id'] === $userId) {
                $updatedAt = $t['updated_at'] ?? null;
                if ($updatedAt !== null && ($max === null || $updatedAt > $max)) {
                    $max = $updatedAt;
                }
            }
        }
        return $max;
    }

    // =========================================================================
    // Invitations
    // =========================================================================

    public function checkEmailRegistered(string $email): bool {
        foreach ($this->users as $user) {
            if (strcasecmp($user['email'] ?? '', $email) === 0) {
                return true;
            }
        }
        return false;
    }

    public function getExistingInvitation(string $email): ?array {
        $now = gmdate('Y-m-d H:i:s');
        $candidates = [];
        foreach ($this->invitations as $inv) {
            if ($inv['email'] === $email && $inv['used_at'] === null && $inv['expires_at'] > $now) {
                $candidates[] = $inv;
            }
        }
        if (empty($candidates)) {
            return null;
        }
        // ORDER BY created_at DESC LIMIT 1
        usort($candidates, function ($a, $b) {
            return strcmp($b['created_at'], $a['created_at']);
        });
        $row = $candidates[0];
        return [
            'id'         => $row['id'],
            'token'      => $row['token'],
            'expires_at' => $row['expires_at'],
        ];
    }

    public function createInvitation(array $data): int {
        $id = ++$this->invitationSeq;
        $now = gmdate('Y-m-d H:i:s');
        $this->invitations[$id] = [
            'id'         => $id,
            'token'      => $data['token'],
            'email'      => $data['email'],
            'invited_by' => $data['invited_by'],
            'expires_at' => $data['expires_at'],
            'used_at'    => null,
            'created_at' => $now,
        ];
        return $id;
    }

    public function validateInviteToken(string $token): ?array {
        foreach ($this->invitations as $inv) {
            if ($inv['token'] === $token) {
                // JOIN users for invited_by_username
                $username = null;
                foreach ($this->users as $user) {
                    if (($user['id'] ?? null) === $inv['invited_by']) {
                        $username = $user['username'] ?? null;
                        break;
                    }
                }
                return [
                    'id'                  => $inv['id'],
                    'email'               => $inv['email'],
                    'expires_at'          => $inv['expires_at'],
                    'used_at'             => $inv['used_at'],
                    'invited_by_username' => $username,
                ];
            }
        }
        return null;
    }

    public function getInvitationsByUser(int $userId): array {
        $results = [];
        foreach ($this->invitations as $inv) {
            if ($inv['invited_by'] === $userId) {
                $results[] = [
                    'id'         => $inv['id'],
                    'email'      => $inv['email'],
                    'token'      => $inv['token'],
                    'expires_at' => $inv['expires_at'],
                    'used_at'    => $inv['used_at'],
                    'created_at' => $inv['created_at'],
                ];
            }
        }
        // ORDER BY created_at DESC LIMIT 50
        usort($results, function ($a, $b) {
            return strcmp($b['created_at'], $a['created_at']);
        });
        return array_slice($results, 0, 50);
    }

    public function getAllInvitations(): array {
        $results = [];
        foreach ($this->invitations as $inv) {
            // JOIN users for invited_by_username
            $username = null;
            foreach ($this->users as $user) {
                if (($user['id'] ?? null) === $inv['invited_by']) {
                    $username = $user['username'] ?? null;
                    break;
                }
            }
            $results[] = [
                'id'                  => $inv['id'],
                'email'               => $inv['email'],
                'token'               => $inv['token'],
                'expires_at'          => $inv['expires_at'],
                'used_at'             => $inv['used_at'],
                'created_at'          => $inv['created_at'],
                'invited_by_username' => $username,
            ];
        }
        // ORDER BY created_at DESC LIMIT 100
        usort($results, function ($a, $b) {
            return strcmp($b['created_at'], $a['created_at']);
        });
        return array_slice($results, 0, 100);
    }

    public function getInvitation(int $id): ?array {
        $inv = $this->invitations[$id] ?? null;
        if (!$inv) {
            return null;
        }
        return [
            'id'         => $inv['id'],
            'invited_by' => $inv['invited_by'],
            'used_at'    => $inv['used_at'],
        ];
    }

    public function deleteInvitation(int $id): void {
        unset($this->invitations[$id]);
    }

    public function markInvitationUsed(int $id): void {
        if (isset($this->invitations[$id])) {
            $this->invitations[$id]['used_at'] = gmdate('Y-m-d H:i:s');
        }
    }

    // =========================================================================
    // Invite Requests
    // =========================================================================

    public function checkExistingInviteRequest(string $email): bool {
        foreach ($this->inviteRequests as $req) {
            if ($req['email'] === $email) {
                return true;
            }
        }
        return false;
    }

    public function createInviteRequest(string $email, ?string $name, string $ipHash): int {
        $id = ++$this->inviteRequestSeq;
        $now = gmdate('Y-m-d H:i:s');
        $this->inviteRequests[$id] = [
            'id'         => $id,
            'email'      => $email,
            'name'       => $name,
            'ip_hash'    => $ipHash,
            'status'     => 'pending',
            'created_at' => $now,
        ];
        return $id;
    }

    public function checkActiveInviteForEmail(string $email): bool {
        $now = gmdate('Y-m-d H:i:s');
        foreach ($this->invitations as $inv) {
            if ($inv['email'] === $email && $inv['used_at'] === null && $inv['expires_at'] > $now) {
                return true;
            }
        }
        return false;
    }

    // =========================================================================
    // Maintenance
    // =========================================================================

    public function cleanupRateLimits(): int {
        $cutoff = gmdate('Y-m-d H:i:s', strtotime('-7 days'));
        $count = 0;
        foreach ($this->rateLimits as $key => $r) {
            $windowStart = $r['window_start'] ?? null;
            if ($windowStart !== null && $windowStart < $cutoff) {
                unset($this->rateLimits[$key]);
                $count++;
            }
        }
        return $count;
    }

    public function cleanupInviteRequests(): int {
        $cutoff = gmdate('Y-m-d H:i:s', strtotime('-30 days'));
        $count = 0;
        foreach ($this->inviteRequests as $key => $r) {
            if (in_array($r['status'] ?? '', ['rejected', 'ignored'], true)
                && isset($r['created_at']) && $r['created_at'] < $cutoff
            ) {
                unset($this->inviteRequests[$key]);
                $count++;
            }
        }
        return $count;
    }

    public function cleanupAuditLogOperational(): int {
        $cutoff = gmdate('Y-m-d H:i:s', strtotime('-30 days'));
        $operationalActions = ['share_created', 'share_revoked', 'system_setting_changed'];
        $count = 0;
        foreach ($this->auditLog as $key => $a) {
            if ($a['created_at'] < $cutoff && in_array($a['action'], $operationalActions, true)) {
                unset($this->auditLog[$key]);
                $count++;
            }
        }
        return $count;
    }

    public function cleanupAuditLogOld(): int {
        $cutoff = gmdate('Y-m-d H:i:s', strtotime('-90 days'));
        $count = 0;
        foreach ($this->auditLog as $key => $a) {
            if ($a['created_at'] < $cutoff) {
                unset($this->auditLog[$key]);
                $count++;
            }
        }
        return $count;
    }

    // =========================================================================
    // Auth — Users
    // =========================================================================

    public function getUserById(int $id): ?array {
        $user = $this->users[$id] ?? null;
        if (!$user) return null;
        return [
            'id'                  => $user['id'],
            'username'            => $user['username'],
            'display_name'        => $user['display_name'] ?? null,
            'email'               => $user['email'] ?? null,
            'role'                => $user['role'] ?? 'user',
            'must_reset_password' => $user['must_reset_password'] ?? 0,
            'created_at'          => $user['created_at'] ?? null,
        ];
    }

    public function getUserByIdentifier(string $usernameOrEmail): ?array {
        foreach ($this->users as $user) {
            if (($user['username'] ?? '') === $usernameOrEmail
                || ($user['email'] ?? '') === $usernameOrEmail) {
                return [
                    'id'                  => $user['id'],
                    'username'            => $user['username'],
                    'display_name'        => $user['display_name'] ?? null,
                    'email'               => $user['email'] ?? null,
                    'password_hash'       => $user['password_hash'] ?? '',
                    'role'                => $user['role'] ?? 'user',
                    'is_active'           => $user['is_active'] ?? 1,
                    'must_reset_password' => $user['must_reset_password'] ?? 0,
                ];
            }
        }
        return null;
    }

    public function getUserActiveAndRole(int $userId): ?array {
        $user = $this->users[$userId] ?? null;
        if (!$user) return null;
        return [
            'is_active'           => $user['is_active'] ?? 1,
            'role'                => $user['role'] ?? 'user',
            'must_reset_password' => $user['must_reset_password'] ?? 0,
        ];
    }

    public function getEmailVerifiedStatus(int $userId): ?bool {
        $user = $this->users[$userId] ?? null;
        if (!$user) return null;
        return (bool)($user['email_verified'] ?? 1);
    }

    public function getUserByEmailVerifyToken(string $token): ?array {
        foreach ($this->users as $user) {
            if (($user['email_verify_token'] ?? null) === $token
                && !($user['email_verified'] ?? 1)) {
                return [
                    'id'                   => $user['id'],
                    'email_verify_expires' => $user['email_verify_expires'] ?? null,
                ];
            }
        }
        return null;
    }

    public function markEmailVerified(int $userId): void {
        if (isset($this->users[$userId])) {
            $this->users[$userId]['email_verified'] = 1;
            $this->users[$userId]['email_verify_token'] = null;
            $this->users[$userId]['email_verify_expires'] = null;
        }
    }

    public function getUserRsaKeyStatus(int $userId): array {
        $user = $this->users[$userId] ?? null;
        return [
            'has_public_key'            => !empty($user['public_key'] ?? null),
            'has_encrypted_private_key' => !empty($user['encrypted_private_key'] ?? null),
        ];
    }

    public function checkDuplicateUser(string $username, string $email, ?int $excludeUserId = null): bool {
        foreach ($this->users as $user) {
            if ($excludeUserId !== null && $user['id'] === $excludeUserId) continue;
            if ($username !== '' && ($user['username'] ?? '') === $username) return true;
            if ($email !== '' && ($user['email'] ?? '') === $email) return true;
        }
        return false;
    }

    public function createUserFromRegistration(array $data): int {
        $id = ++$this->userSeq;
        $now = date('Y-m-d H:i:s');
        $this->users[$id] = [
            'id'                   => $id,
            'username'             => $data['username'],
            'email'                => $data['email'],
            'password_hash'        => $data['password_hash'],
            'role'                 => $data['role'],
            'is_active'            => 1,
            'email_verified'       => $data['email_verified'],
            'email_verify_token'   => $data['email_verify_token'],
            'email_verify_expires' => $data['email_verify_expires'],
            'must_reset_password'  => 0,
            'failed_login_attempts' => 0,
            'locked_until'         => null,
            'last_failed_login_at' => null,
            'created_at'           => $now,
        ];
        return $id;
    }

    public function updateUserProfile(int $userId, array $fields): void {
        if (!isset($this->users[$userId])) return;
        $allowed = ['username', 'display_name', 'email'];
        foreach ($fields as $col => $val) {
            if (in_array($col, $allowed, true)) {
                $this->users[$userId][$col] = $val;
            }
        }
    }

    public function getPasswordHash(int $userId): ?string {
        $user = $this->users[$userId] ?? null;
        return $user ? ($user['password_hash'] ?? null) : null;
    }

    public function updateUserPassword(int $userId, string $hash): void {
        if (isset($this->users[$userId])) {
            $this->users[$userId]['password_hash'] = $hash;
        }
    }

    public function resetPasswordAndUnlock(int $userId, string $hash): void {
        if (isset($this->users[$userId])) {
            $this->users[$userId]['password_hash'] = $hash;
            $this->users[$userId]['must_reset_password'] = 0;
            $this->users[$userId]['failed_login_attempts'] = 0;
            $this->users[$userId]['locked_until'] = null;
            $this->users[$userId]['last_failed_login_at'] = null;
        }
    }

    public function getMustResetPassword(int $userId): ?bool {
        $user = $this->users[$userId] ?? null;
        if (!$user) return null;
        return (bool)($user['must_reset_password'] ?? 0);
    }

    public function getAdminCount(int $excludeUserId): int {
        $count = 0;
        foreach ($this->users as $user) {
            if (($user['role'] ?? 'user') === 'admin'
                && ($user['is_active'] ?? 1) == 1
                && $user['id'] !== $excludeUserId) {
                $count++;
            }
        }
        return $count;
    }

    public function deleteUserById(int $userId): bool {
        if (!isset($this->users[$userId])) {
            return false;
        }
        unset($this->users[$userId]);
        return true;
    }

    public function getUserWithRecoveryMaterial(string $usernameOrEmail): ?array {
        foreach ($this->users as $user) {
            if (($user['username'] ?? '') === $usernameOrEmail
                || ($user['email'] ?? '') === $usernameOrEmail) {
                // LEFT JOIN user_vault_keys
                $vk = $this->vaultKeys[$user['id']] ?? null;
                return [
                    'id'                    => $user['id'],
                    'is_active'             => $user['is_active'] ?? 1,
                    'recovery_key_salt'     => $vk ? ($vk['recovery_key_salt'] ?? null) : null,
                    'encrypted_dek_recovery' => $vk ? ($vk['encrypted_dek_recovery'] ?? null) : null,
                ];
            }
        }
        return null;
    }

    public function getUsernameById(int $userId): ?string {
        $user = $this->users[$userId] ?? null;
        return $user ? ($user['username'] ?? null) : null;
    }

    // =========================================================================
    // Auth — Lockout & Rate Limiting
    // =========================================================================

    public function incrementFailedLogin(int $userId): void {
        if (isset($this->users[$userId])) {
            $this->users[$userId]['failed_login_attempts'] = ($this->users[$userId]['failed_login_attempts'] ?? 0) + 1;
            $this->users[$userId]['last_failed_login_at'] = date('Y-m-d H:i:s');
        }
    }

    public function getFailedLoginInfo(int $userId): ?array {
        $user = $this->users[$userId] ?? null;
        if (!$user) return null;
        return [
            'failed_login_attempts' => $user['failed_login_attempts'] ?? 0,
            'email'                 => $user['email'] ?? null,
        ];
    }

    public function setUserMustResetPassword(int $userId, bool $must): void {
        if (isset($this->users[$userId])) {
            $this->users[$userId]['must_reset_password'] = $must ? 1 : 0;
        }
    }

    public function setUserLockedUntil(int $userId, ?string $until): void {
        if (isset($this->users[$userId])) {
            $this->users[$userId]['locked_until'] = $until;
        }
    }

    public function resetLoginLockout(int $userId): void {
        if (isset($this->users[$userId])) {
            $this->users[$userId]['failed_login_attempts'] = 0;
            $this->users[$userId]['locked_until'] = null;
            $this->users[$userId]['last_failed_login_at'] = null;
        }
    }

    public function getUserLockoutStatus(int $userId): ?array {
        $user = $this->users[$userId] ?? null;
        if (!$user) return null;
        return ['locked_until' => $user['locked_until'] ?? null];
    }

    public function getRateLimit(string $action, string $identifier): ?array {
        $key = $action . '::' . $identifier;
        $entry = $this->rateLimits[$key] ?? null;
        if (!$entry) return null;
        return [
            'attempts'     => $entry['attempts'],
            'window_start' => $entry['window_start'],
        ];
    }

    public function upsertRateLimit(string $action, string $identifier): void {
        $key = $action . '::' . $identifier;
        if (isset($this->rateLimits[$key])) {
            $this->rateLimits[$key]['attempts']++;
        } else {
            $this->rateLimits[$key] = [
                'action'       => $action,
                'identifier'   => $identifier,
                'attempts'     => 1,
                'window_start' => date('Y-m-d H:i:s'),
            ];
        }
    }

    public function deleteRateLimit(string $action, string $identifier): void {
        $key = $action . '::' . $identifier;
        unset($this->rateLimits[$key]);
    }

    public function deleteExpiredRateLimits(int $windowSeconds): void {
        $cutoff = date('Y-m-d H:i:s', time() - $windowSeconds);
        foreach ($this->rateLimits as $key => $entry) {
            if (($entry['window_start'] ?? '') < $cutoff) {
                unset($this->rateLimits[$key]);
            }
        }
    }

    // =========================================================================
    // Auth — Password History
    // =========================================================================

    private array $passwordHistory = [];
    private int $passwordHistorySeq = 0;

    public function getPasswordHistory(int $userId, int $limit): array {
        $results = [];
        foreach ($this->passwordHistory as $entry) {
            if ($entry['user_id'] === $userId) {
                $results[] = $entry;
            }
        }
        // ORDER BY created_at DESC
        usort($results, function ($a, $b) {
            return strcmp($b['created_at'], $a['created_at']);
        });
        // LIMIT
        $results = array_slice($results, 0, $limit);
        return array_map(function ($e) {
            return ['password_hash' => $e['password_hash']];
        }, $results);
    }

    public function addPasswordHistory(int $userId, string $hash): void {
        $id = ++$this->passwordHistorySeq;
        $this->passwordHistory[$id] = [
            'id'            => $id,
            'user_id'       => $userId,
            'password_hash' => $hash,
            'created_at'    => date('Y-m-d H:i:s'),
        ];
    }

    public function prunePasswordHistory(int $userId, int $keepCount): void {
        // Collect entries for this user
        $userEntries = [];
        foreach ($this->passwordHistory as $id => $entry) {
            if ($entry['user_id'] === $userId) {
                $userEntries[$id] = $entry;
            }
        }
        // Sort by created_at DESC
        uasort($userEntries, function ($a, $b) {
            return strcmp($b['created_at'], $a['created_at']);
        });
        // Keep only $keepCount, delete rest
        $kept = 0;
        foreach ($userEntries as $id => $entry) {
            $kept++;
            if ($kept > $keepCount) {
                unset($this->passwordHistory[$id]);
            }
        }
    }

    // =========================================================================
    // WebAuthn
    // =========================================================================

    public function createWebAuthnChallenge(?int $userId, string $challenge, string $type): int {
        $id = ++$this->webauthnChallengeSeq;
        $now = gmdate('Y-m-d H:i:s');
        $expiresAt = gmdate('Y-m-d H:i:s', strtotime($now . ' +5 minutes'));
        $this->webauthnChallenges[$id] = [
            'id'         => $id,
            'challenge'  => $challenge,
            'user_id'    => $userId,
            'type'       => $type,
            'expires_at' => $expiresAt,
        ];
        return $id;
    }

    public function getWebAuthnChallenge(int $challengeId): ?array {
        $row = $this->webauthnChallenges[$challengeId] ?? null;
        if (!$row) return null;
        // Check expiry (expires_at > NOW())
        $now = gmdate('Y-m-d H:i:s');
        if ($row['expires_at'] <= $now) return null;
        return [
            'challenge' => $row['challenge'],
            'user_id'   => $row['user_id'],
            'type'      => $row['type'],
        ];
    }

    public function deleteWebAuthnChallenge(int $challengeId): void {
        unset($this->webauthnChallenges[$challengeId]);
    }

    public function getExistingCredentialIds(int $userId): array {
        $results = [];
        foreach ($this->webauthnCredentials as $cred) {
            if ($cred['user_id'] === $userId) {
                $results[] = $cred['credential_id'];
            }
        }
        return $results;
    }

    public function registerWebAuthnCredential(int $userId, string $credentialId, string $publicKey, int $signCount, string $transports, string $name): int {
        $id = ++$this->webauthnCredentialSeq;
        $now = gmdate('Y-m-d H:i:s');
        $this->webauthnCredentials[$id] = [
            'id'            => $id,
            'user_id'       => $userId,
            'credential_id' => $credentialId,
            'public_key'    => $publicKey,
            'sign_count'    => $signCount,
            'transports'    => $transports,
            'name'          => $name,
            'created_at'    => $now,
            'last_used_at'  => null,
        ];
        return $id;
    }

    public function getWebAuthnCredentialForAuth(string $credentialId): ?array {
        foreach ($this->webauthnCredentials as $cred) {
            if ($cred['credential_id'] === $credentialId) {
                // JOIN users
                $user = $this->users[$cred['user_id']] ?? null;
                if (!$user) return null;
                return [
                    'user_id'       => $cred['user_id'],
                    'public_key'    => $cred['public_key'],
                    'sign_count'    => $cred['sign_count'],
                    'credential_id' => $cred['credential_id'],
                    'id'            => $user['id'],
                    'username'      => $user['username'] ?? null,
                    'email'         => $user['email'] ?? null,
                    'role'          => $user['role'] ?? 'user',
                    'is_active'     => $user['is_active'] ?? 1,
                ];
            }
        }
        return null;
    }

    public function updateWebAuthnCredentialUsage(string $credentialId, int $signCount): void {
        foreach ($this->webauthnCredentials as &$cred) {
            if ($cred['credential_id'] === $credentialId) {
                $cred['sign_count'] = $signCount;
                $cred['last_used_at'] = gmdate('Y-m-d H:i:s');
                return;
            }
        }
        unset($cred);
    }

    public function listWebAuthnCredentials(int $userId): array {
        $results = [];
        foreach ($this->webauthnCredentials as $cred) {
            if ($cred['user_id'] === $userId) {
                $results[] = [
                    'id'            => $cred['id'],
                    'credential_id' => $cred['credential_id'],
                    'name'          => $cred['name'],
                    'transports'    => $cred['transports'],
                    'created_at'    => $cred['created_at'],
                    'last_used_at'  => $cred['last_used_at'],
                ];
            }
        }
        // ORDER BY created_at DESC
        usort($results, function ($a, $b) {
            return strcmp($b['created_at'], $a['created_at']);
        });
        return $results;
    }

    public function getWebAuthnCredentialOwnership(int $credentialId, int $userId): bool {
        $cred = $this->webauthnCredentials[$credentialId] ?? null;
        return $cred !== null && $cred['user_id'] === $userId;
    }

    public function renameWebAuthnCredential(int $credentialId, int $userId, string $name): void {
        if (isset($this->webauthnCredentials[$credentialId])
            && $this->webauthnCredentials[$credentialId]['user_id'] === $userId) {
            $this->webauthnCredentials[$credentialId]['name'] = $name;
        }
    }

    public function deleteWebAuthnCredential(int $credentialId, int $userId): void {
        if (isset($this->webauthnCredentials[$credentialId])
            && $this->webauthnCredentials[$credentialId]['user_id'] === $userId) {
            unset($this->webauthnCredentials[$credentialId]);
        }
    }

    // =========================================================================
    // Plaid
    // =========================================================================

    public function upsertPlaidItem(int $userId, string $itemId, string $encryptedAccessToken): void {
        // ON DUPLICATE KEY: dedup on (user_id, item_id)
        foreach ($this->plaidItems as &$item) {
            if ($item['user_id'] === $userId && $item['item_id'] === $itemId) {
                $item['access_token'] = $encryptedAccessToken;
                $item['status'] = 'active';
                $item['updated_at'] = gmdate('Y-m-d H:i:s');
                return;
            }
        }
        unset($item);
        $now = gmdate('Y-m-d H:i:s');
        $this->plaidItems[] = [
            'user_id'      => $userId,
            'item_id'      => $itemId,
            'access_token' => $encryptedAccessToken,
            'status'       => 'active',
            'created_at'   => $now,
            'updated_at'   => $now,
        ];
    }

    public function getPlaidItems(int $userId, array $itemIds): array {
        if (empty($itemIds)) {
            return [];
        }
        $results = [];
        foreach ($this->plaidItems as $item) {
            if ($item['user_id'] === $userId && in_array($item['item_id'], $itemIds, true)) {
                $results[] = [
                    'item_id'      => $item['item_id'],
                    'access_token' => $item['access_token'],
                ];
            }
        }
        return $results;
    }

    public function updatePlaidItemStatus(string $itemId, int $userId, string $status): void {
        foreach ($this->plaidItems as &$item) {
            if ($item['item_id'] === $itemId && $item['user_id'] === $userId) {
                $item['status'] = $status;
                $item['updated_at'] = gmdate('Y-m-d H:i:s');
                return;
            }
        }
        unset($item);
    }

    public function getPlaidItem(int $userId, string $itemId): ?array {
        foreach ($this->plaidItems as $item) {
            if ($item['user_id'] === $userId && $item['item_id'] === $itemId) {
                return ['access_token' => $item['access_token']];
            }
        }
        return null;
    }

    public function deletePlaidItem(int $userId, string $itemId): void {
        $this->plaidItems = array_values(array_filter($this->plaidItems, function ($item) use ($userId, $itemId) {
            return !($item['user_id'] === $userId && $item['item_id'] === $itemId);
        }));
    }

    public function getPlaidItemsByUser(int $userId): array {
        $results = [];
        foreach ($this->plaidItems as $item) {
            if ($item['user_id'] === $userId) {
                $results[] = [
                    'item_id'    => $item['item_id'],
                    'status'     => $item['status'],
                    'created_at' => $item['created_at'],
                    'updated_at' => $item['updated_at'],
                ];
            }
        }
        // ORDER BY created_at DESC
        usort($results, fn($a, $b) => strcmp($b['created_at'], $a['created_at']));
        return $results;
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
            'name'         => $t['name'],
            'icon'         => $t['icon'] ?? null,
            'key'          => $t['template_key'] ?? null,
            'subtype'      => $t['subtype'] ?? null,
            'is_liability' => isset($t['is_liability']) ? (bool)(int)$t['is_liability'] : false,
            'fields'       => $fields,
        ];
    }
}
