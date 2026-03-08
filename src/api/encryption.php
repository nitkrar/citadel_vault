<?php
/**
 * Personal Vault — Encryption API
 * Manages vault encryption key lifecycle: setup, unlock, change, recovery, and session preferences.
 */
require_once __DIR__ . '/../core/Response.php';
require_once __DIR__ . '/../../config/config.php';
require_once __DIR__ . '/../core/Auth.php';
require_once __DIR__ . '/../core/Encryption.php';

Response::setCors();

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? null;
$db = Database::getConnection();

// ---------------------------------------------------------------------------
// GET ?action=vault-key-policy — Public: vault key requirements
// ---------------------------------------------------------------------------
if ($method === 'GET' && $action === 'vault-key-policy') {
    $mode = VAULT_KEY_MODE;
    $minLen = VAULT_KEY_MIN_LENGTH;
    $desc = match($mode) {
        'numeric'      => "$minLen+ digits",
        'alphanumeric' => "$minLen+ characters (letters and numbers)",
        default        => "$minLen+ characters",
    };
    Response::success([
        'min_length'  => $minLen,
        'mode'        => $mode,
        'description' => $desc,
    ]);
}

/**
 * Determine data session expiry timestamp based on user preference.
 */
function getSessionExpiry(string $preference): int {
    return match($preference) {
        'timed' => time() + DATA_SESSION_EXPIRY_TIMED,
        'login' => time() + DATA_SESSION_EXPIRY_LOGIN,
        default => time() + DATA_SESSION_EXPIRY_SESSION,
    };
}

// ---------------------------------------------------------------------------
// GET ?action=status — Return vault key status and session preference
// ---------------------------------------------------------------------------
if ($method === 'GET' && $action === 'status') {
    $payload = Auth::requireAuth();
    $userId = $payload['sub'];

    $stmt = $db->prepare("SELECT has_vault_key, vault_session_preference FROM users WHERE id = ?");
    $stmt->execute([$userId]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$row) {
        Response::error('User not found.', 404);
    }

    $result = [
        'has_vault_key'            => (bool)$row['has_vault_key'],
        'vault_session_preference' => $row['vault_session_preference'],
        'must_change_vault_key'    => false,
        'admin_action_message'     => null,
    ];

    // Fetch new columns with migration resilience
    try {
        $stmt2 = $db->prepare("SELECT must_change_vault_key, admin_action_message FROM users WHERE id = ?");
        $stmt2->execute([$userId]);
        $row2 = $stmt2->fetch(PDO::FETCH_ASSOC);
        if ($row2) {
            $result['must_change_vault_key'] = (bool)($row2['must_change_vault_key'] ?? false);
            $result['admin_action_message']  = $row2['admin_action_message'] ?? null;
        }
    } catch (Exception $e) {
        // Columns may not exist yet — defaults already set
    }

    Response::success($result);
}

// ---------------------------------------------------------------------------
// POST ?action=setup — First-time vault key setup
// ---------------------------------------------------------------------------
if ($method === 'POST' && $action === 'setup') {
    $payload = Auth::requireAuth();
    $userId = $payload['sub'];
    $body = Response::getBody();

    $vaultKey        = $body['vault_key'] ?? '';
    $confirmVaultKey = $body['confirm_vault_key'] ?? '';

    // Validate keys match
    if ($vaultKey !== $confirmVaultKey) {
        Response::error('Vault keys do not match.', 400);
    }

    // Validate vault key format
    if (!Encryption::validateVaultKey($vaultKey)) {
        Response::error('Vault key must be at least ' . VAULT_KEY_MIN_LENGTH . ' characters.', 400);
    }

    // Ensure user doesn't already have a vault key
    $stmt = $db->prepare("SELECT has_vault_key FROM users WHERE id = ?");
    $stmt->execute([$userId]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$row) {
        Response::error('User not found.', 404);
    }
    if ((int)$row['has_vault_key'] === 1) {
        Response::error('Vault key already set up.', 400);
    }

    // Generate DEK and wrap it with the vault key
    $dek = Encryption::generateDek();
    $salt = Encryption::generateSalt();
    $wrappingKey = Encryption::deriveWrappingKey($vaultKey, $salt);
    $encryptedDek = Encryption::wrapDek($dek, $wrappingKey);

    // Generate recovery key and wrap DEK with it
    $recoveryKey = bin2hex(random_bytes(16));
    $recoverySalt = Encryption::generateSalt();
    $recoveryWrappingKey = Encryption::deriveWrappingKey($recoveryKey, $recoverySalt);
    $encryptedDekRecovery = Encryption::wrapDek($dek, $recoveryWrappingKey);

    // Encrypt recovery key with DEK for later retrieval
    $recoveryKeyEncrypted = Encryption::encryptRecoveryKey($recoveryKey, $dek);

    // Generate RSA key pair for sharing
    $rsaKeys = Encryption::generateRsaKeyPair();
    $encryptedPrivateKey = Encryption::encryptPrivateKey($rsaKeys['private_key'], $dek);

    // Store everything in the database
    $stmt = $db->prepare(
        "UPDATE users SET
            vault_key_salt = ?,
            encrypted_dek = ?,
            recovery_key_salt = ?,
            encrypted_dek_recovery = ?,
            recovery_key_encrypted = ?,
            has_vault_key = 1,
            public_key = ?,
            encrypted_private_key = ?
         WHERE id = ?"
    );
    $stmt->execute([
        $salt,
        $encryptedDek,
        $recoverySalt,
        $encryptedDekRecovery,
        $recoveryKeyEncrypted,
        $rsaKeys['public_key'],
        $encryptedPrivateKey,
        $userId,
    ]);

    // Create data session token
    $stmt = $db->prepare("SELECT vault_session_preference FROM users WHERE id = ?");
    $stmt->execute([$userId]);
    $pref = $stmt->fetchColumn();
    $expiry = getSessionExpiry($pref);
    $dataToken = Encryption::createDataSessionToken($dek, $expiry);

    // Set HttpOnly cookie
    Encryption::setDataTokenCookie($dataToken, $expiry);

    Response::success([
        'data_token'   => $dataToken,
        'recovery_key' => $recoveryKey,
        'expires_at'   => $expiry,
    ]);
}

// ---------------------------------------------------------------------------
// POST ?action=unlock — Unlock vault with vault key
// ---------------------------------------------------------------------------
if ($method === 'POST' && $action === 'unlock') {
    $payload = Auth::requireAuth();
    $userId = $payload['sub'];
    $body = Response::getBody();

    $vaultKey = $body['vault_key'] ?? '';

    // Validate vault key format (accepts legacy 6+ numeric AND new 8+ any)
    if (!Encryption::validateVaultKey($vaultKey)) {
        Response::error('Invalid vault key format.', 400);
    }

    // --- Vault lockout check ---
    try {
        $stmt = $db->prepare("SELECT failed_vault_attempts, vault_locked_until FROM users WHERE id = ?");
        $stmt->execute([$userId]);
        $lockRow = $stmt->fetch(PDO::FETCH_ASSOC);
        if ($lockRow && $lockRow['vault_locked_until']) {
            $lockedUntil = strtotime($lockRow['vault_locked_until']);
            if ($lockedUntil > time()) {
                $remaining = ceil(($lockedUntil - time()) / 60);
                Response::error("Vault is locked due to too many failed attempts. Try again in $remaining minute(s).", 429);
            }
        }
    } catch (Exception $e) {
        // Columns may not exist — skip
    }

    // Fetch vault data (include recovery columns for backfill check)
    $stmt = $db->prepare(
        "SELECT vault_key_salt, encrypted_dek, vault_session_preference,
                recovery_key_salt, encrypted_dek_recovery, recovery_key_encrypted
         FROM users WHERE id = ?"
    );
    $stmt->execute([$userId]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$row) {
        Response::error('User not found.', 404);
    }

    // Derive wrapping key and unwrap DEK
    $wrappingKey = Encryption::deriveWrappingKey($vaultKey, $row['vault_key_salt']);
    $dek = Encryption::unwrapDek($row['encrypted_dek'], $wrappingKey);

    if ($dek === null) {
        // --- Track failed vault attempt ---
        try {
            $db->prepare("UPDATE users SET failed_vault_attempts = failed_vault_attempts + 1 WHERE id = ?")
               ->execute([$userId]);

            $stmt = $db->prepare("SELECT failed_vault_attempts, email, username FROM users WHERE id = ?");
            $stmt->execute([$userId]);
            $failRow = $stmt->fetch(PDO::FETCH_ASSOC);
            $attempts = (int)($failRow['failed_vault_attempts'] ?? 0);
            $ip = $_SERVER['REMOTE_ADDR'] ?? null;

            // Tier 1: 3 attempts → 15 min lock
            if ($attempts === LOCKOUT_TIER1_ATTEMPTS) {
                $lockUntil = date('Y-m-d H:i:s', time() + LOCKOUT_TIER1_DURATION);
                $db->prepare("UPDATE users SET vault_locked_until = ? WHERE id = ?")->execute([$lockUntil, $userId]);
                try { $db->prepare("INSERT INTO audit_log (user_id, action, resource_type) VALUES (?, 'vault_locked_tier1', 'users')")->execute([$userId]); } catch (Exception $e) {}
                if (defined('SMTP_ENABLED') && SMTP_ENABLED && $failRow['email']) {
                    Mailer::sendLockoutNotification($failRow['email'], $failRow['username'], $attempts, $ip, '15 minutes');
                }
            }
            // Tier 2: 6 attempts → 1 hour lock
            elseif ($attempts === LOCKOUT_TIER2_ATTEMPTS) {
                $lockUntil = date('Y-m-d H:i:s', time() + LOCKOUT_TIER2_DURATION);
                $db->prepare("UPDATE users SET vault_locked_until = ? WHERE id = ?")->execute([$lockUntil, $userId]);
                try { $db->prepare("INSERT INTO audit_log (user_id, action, resource_type) VALUES (?, 'vault_locked_tier2', 'users')")->execute([$userId]); } catch (Exception $e) {}
                if (defined('SMTP_ENABLED') && SMTP_ENABLED && $failRow['email']) {
                    Mailer::sendLockoutNotification($failRow['email'], $failRow['username'], $attempts, $ip, '1 hour');
                }
            }
            // Tier 3: 9+ attempts → force vault key change
            elseif ($attempts >= LOCKOUT_TIER3_ATTEMPTS && $attempts % 3 === 0) {
                $lockUntil = date('Y-m-d H:i:s', time() + 86400 * 365);
                $db->prepare("UPDATE users SET vault_locked_until = ?, must_change_vault_key = 1 WHERE id = ?")->execute([$lockUntil, $userId]);
                try { $db->prepare("INSERT INTO audit_log (user_id, action, resource_type) VALUES (?, 'vault_locked_permanent', 'users')")->execute([$userId]); } catch (Exception $e) {}
                if (defined('SMTP_ENABLED') && SMTP_ENABLED && $failRow['email']) {
                    Mailer::sendLockoutNotification($failRow['email'], $failRow['username'], $attempts, $ip, null);
                }
            }
        } catch (Exception $e) {
            // Lockout columns may not exist — non-fatal
        }
        Response::error('Invalid vault key.', 400);
    }

    // --- Successful unlock: reset vault lockout counters ---
    try {
        $db->prepare("UPDATE users SET failed_vault_attempts = 0, vault_locked_until = NULL WHERE id = ?")
           ->execute([$userId]);
    } catch (Exception $e) {
        // non-fatal
    }

    // Backfill recovery key for existing users who don't have one
    $newRecoveryKey = null;
    if (empty($row['recovery_key_salt']) || empty($row['encrypted_dek_recovery'])) {
        $newRecoveryKey = bin2hex(random_bytes(16));
        $recoverySalt = Encryption::generateSalt();
        $recoveryWrappingKey = Encryption::deriveWrappingKey($newRecoveryKey, $recoverySalt);
        $encryptedDekRecovery = Encryption::wrapDek($dek, $recoveryWrappingKey);
        $recoveryKeyEncrypted = Encryption::encryptRecoveryKey($newRecoveryKey, $dek);

        $stmt = $db->prepare(
            "UPDATE users SET
                recovery_key_salt = ?,
                encrypted_dek_recovery = ?,
                recovery_key_encrypted = ?
             WHERE id = ?"
        );
        $stmt->execute([$recoverySalt, $encryptedDekRecovery, $recoveryKeyEncrypted, $userId]);
    }

    // Create data session token
    $expiry = getSessionExpiry($row['vault_session_preference']);
    $dataToken = Encryption::createDataSessionToken($dek, $expiry);

    // Set HttpOnly cookie
    Encryption::setDataTokenCookie($dataToken, $expiry);

    $response = [
        'data_token'         => $dataToken,
        'expires_at'         => $expiry,
        'session_preference' => $row['vault_session_preference'],
    ];

    // Include recovery key if newly generated (so user can save it)
    if ($newRecoveryKey !== null) {
        $response['recovery_key'] = $newRecoveryKey;
    }

    Response::success($response);
}

// ---------------------------------------------------------------------------
// POST ?action=change — Change vault key (via old key or recovery key)
// ---------------------------------------------------------------------------
if ($method === 'POST' && $action === 'change') {
    $payload = Auth::requireAuth();
    $dek = Encryption::requireDek();
    $userId = $payload['sub'];
    $body = Response::getBody();

    $changeMethod     = $body['method'] ?? '';
    $newVaultKey      = $body['new_vault_key'] ?? '';
    $confirmNewKey    = $body['confirm_new_vault_key'] ?? '';

    // Validate new vault key
    if ($newVaultKey !== $confirmNewKey) {
        Response::error('New vault keys do not match.', 400);
    }
    if (!Encryption::validateVaultKey($newVaultKey)) {
        Response::error('Vault key must be at least ' . VAULT_KEY_MIN_LENGTH . ' characters.', 400);
    }

    // Fetch user vault data
    $stmt = $db->prepare(
        "SELECT vault_key_salt, encrypted_dek, recovery_key_salt, encrypted_dek_recovery, recovery_key_encrypted
         FROM users WHERE id = ?"
    );
    $stmt->execute([$userId]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$row) {
        Response::error('User not found.', 404);
    }

    // Verify identity based on method
    if ($changeMethod === 'vault_key') {
        $oldVaultKey = $body['old_vault_key'] ?? '';
        $oldWrappingKey = Encryption::deriveWrappingKey($oldVaultKey, $row['vault_key_salt']);
        $verifiedDek = Encryption::unwrapDek($row['encrypted_dek'], $oldWrappingKey);

        if ($verifiedDek === null) {
            Response::error('Invalid current vault key.', 400);
        }
    } elseif ($changeMethod === 'recovery') {
        $recoveryKey = $body['recovery_key'] ?? '';

        // Decrypt stored recovery key with DEK and verify it matches
        $storedRecoveryKey = Encryption::decryptRecoveryKey($row['recovery_key_encrypted'], $dek);

        if ($storedRecoveryKey === null || !hash_equals($storedRecoveryKey, $recoveryKey)) {
            Response::error('Invalid recovery key.', 400);
        }

        // Use recovery salt + key to unwrap DEK as additional verification
        $recoveryWrappingKey = Encryption::deriveWrappingKey($recoveryKey, $row['recovery_key_salt']);
        $verifiedDek = Encryption::unwrapDek($row['encrypted_dek_recovery'], $recoveryWrappingKey);

        if ($verifiedDek === null) {
            Response::error('Recovery key verification failed.', 400);
        }

        // Audit log for recovery key usage
        try {
            $db->prepare(
                "INSERT INTO audit_log (user_id, action, resource_type, ip_address) VALUES (?, 'recovery_key_vault_change', 'users', ?)"
            )->execute([$userId, $_SERVER['REMOTE_ADDR'] ?? null]);
        } catch (Exception $e) {
            // audit_log table may not exist — non-fatal
        }
    } else {
        Response::error('Invalid method. Use "vault_key" or "recovery".', 400);
    }

    // Re-wrap DEK with new vault key
    $newSalt = Encryption::generateSalt();
    $newWrappingKey = Encryption::deriveWrappingKey($newVaultKey, $newSalt);
    $newEncryptedDek = Encryption::wrapDek($dek, $newWrappingKey);

    // Only rotate recovery key if it was used (consumed) to authenticate
    $newRecoveryKey = null;
    if ($changeMethod === 'recovery') {
        $newRecoveryKey = bin2hex(random_bytes(16));
        $newRecoverySalt = Encryption::generateSalt();
        $newRecoveryWrappingKey = Encryption::deriveWrappingKey($newRecoveryKey, $newRecoverySalt);
        $newEncryptedDekRecovery = Encryption::wrapDek($dek, $newRecoveryWrappingKey);
        $newRecoveryKeyEncrypted = Encryption::encryptRecoveryKey($newRecoveryKey, $dek);
    }

    // Update vault key fields in DB and clear forced vault key change flag
    if ($newRecoveryKey !== null) {
        // Recovery key was used — update vault key + rotate recovery key
        try {
            $stmt = $db->prepare(
                "UPDATE users SET
                    vault_key_salt = ?,
                    encrypted_dek = ?,
                    recovery_key_salt = ?,
                    encrypted_dek_recovery = ?,
                    recovery_key_encrypted = ?,
                    must_change_vault_key = 0,
                    admin_action_message = NULL,
                    failed_vault_attempts = 0,
                    vault_locked_until = NULL
                 WHERE id = ?"
            );
            $stmt->execute([
                $newSalt, $newEncryptedDek,
                $newRecoverySalt, $newEncryptedDekRecovery, $newRecoveryKeyEncrypted,
                $userId,
            ]);
        } catch (PDOException $e) {
            $stmt = $db->prepare(
                "UPDATE users SET
                    vault_key_salt = ?, encrypted_dek = ?,
                    recovery_key_salt = ?, encrypted_dek_recovery = ?, recovery_key_encrypted = ?
                 WHERE id = ?"
            );
            $stmt->execute([
                $newSalt, $newEncryptedDek,
                $newRecoverySalt, $newEncryptedDekRecovery, $newRecoveryKeyEncrypted,
                $userId,
            ]);
        }
    } else {
        // Vault key method — only update the vault key wrapping, keep recovery key unchanged
        try {
            $stmt = $db->prepare(
                "UPDATE users SET
                    vault_key_salt = ?,
                    encrypted_dek = ?,
                    must_change_vault_key = 0,
                    admin_action_message = NULL,
                    failed_vault_attempts = 0,
                    vault_locked_until = NULL
                 WHERE id = ?"
            );
            $stmt->execute([$newSalt, $newEncryptedDek, $userId]);
        } catch (PDOException $e) {
            $stmt = $db->prepare(
                "UPDATE users SET vault_key_salt = ?, encrypted_dek = ? WHERE id = ?"
            );
            $stmt->execute([$newSalt, $newEncryptedDek, $userId]);
        }
    }

    // Create new data session token
    $stmt = $db->prepare("SELECT vault_session_preference FROM users WHERE id = ?");
    $stmt->execute([$userId]);
    $pref = $stmt->fetchColumn();
    $expiry = getSessionExpiry($pref);
    $dataToken = Encryption::createDataSessionToken($dek, $expiry);

    $response = [
        'data_token' => $dataToken,
        'expires_at' => $expiry,
    ];

    // Only include new recovery key if it was rotated
    if ($newRecoveryKey !== null) {
        $response['recovery_key'] = $newRecoveryKey;
    }

    Response::success($response);
}

// ---------------------------------------------------------------------------
// POST ?action=view-recovery-key — View the current recovery key
// ---------------------------------------------------------------------------
if ($method === 'POST' && $action === 'view-recovery-key') {
    $payload = Auth::requireAuth();
    $dek = Encryption::requireDek();
    $userId = $payload['sub'];

    $stmt = $db->prepare("SELECT recovery_key_encrypted FROM users WHERE id = ?");
    $stmt->execute([$userId]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$row) {
        Response::error('User not found.', 404);
    }

    $recoveryKey = Encryption::decryptRecoveryKey($row['recovery_key_encrypted'], $dek);

    if ($recoveryKey === null) {
        Response::error('Failed to decrypt recovery key.', 500);
    }

    Response::success([
        'recovery_key' => $recoveryKey,
    ]);
}

// ---------------------------------------------------------------------------
// POST ?action=regenerate-recovery-key — Generate a new recovery key
// ---------------------------------------------------------------------------
if ($method === 'POST' && $action === 'regenerate-recovery-key') {
    $payload = Auth::requireAuth();
    $dek = Encryption::requireDek();
    $userId = $payload['sub'];

    // Generate new recovery key and wrap DEK with it
    $newRecoveryKey = bin2hex(random_bytes(16));
    $newRecoverySalt = Encryption::generateSalt();
    $newRecoveryWrappingKey = Encryption::deriveWrappingKey($newRecoveryKey, $newRecoverySalt);
    $newEncryptedDekRecovery = Encryption::wrapDek($dek, $newRecoveryWrappingKey);
    $newRecoveryKeyEncrypted = Encryption::encryptRecoveryKey($newRecoveryKey, $dek);

    $stmt = $db->prepare(
        "UPDATE users SET
            recovery_key_salt = ?,
            encrypted_dek_recovery = ?,
            recovery_key_encrypted = ?
         WHERE id = ?"
    );
    $stmt->execute([$newRecoverySalt, $newEncryptedDekRecovery, $newRecoveryKeyEncrypted, $userId]);

    // Audit log
    try {
        $db->prepare(
            "INSERT INTO audit_log (user_id, action, resource_type, ip_address) VALUES (?, 'recovery_key_regenerated', 'users', ?)"
        )->execute([$userId, $_SERVER['REMOTE_ADDR'] ?? null]);
    } catch (Exception $e) {
        // non-fatal
    }

    Response::success([
        'recovery_key' => $newRecoveryKey,
    ]);
}

// ---------------------------------------------------------------------------
// GET ?action=recovery-audit — Recovery key audit log for current user
// ---------------------------------------------------------------------------
if ($method === 'GET' && $action === 'recovery-audit') {
    $payload = Auth::requireAuth();
    $userId = $payload['sub'];

    try {
        $stmt = $db->prepare(
            "SELECT action, ip_address, created_at
             FROM audit_log
             WHERE user_id = ? AND action LIKE 'recovery_key%'
             ORDER BY created_at DESC
             LIMIT 50"
        );
        $stmt->execute([$userId]);
        Response::success($stmt->fetchAll(PDO::FETCH_ASSOC));
    } catch (Exception $e) {
        // audit_log table may not exist
        Response::success([]);
    }
}

// ---------------------------------------------------------------------------
// PUT ?action=preference — Update vault session preference
// ---------------------------------------------------------------------------
if ($method === 'PUT' && $action === 'preference') {
    $payload = Auth::requireAuth();
    $userId = $payload['sub'];
    $body = Response::getBody();

    $preference = $body['preference'] ?? '';

    if (!in_array($preference, ['session', 'timed', 'login'], true)) {
        Response::error('Invalid preference. Must be "session", "timed", or "login".', 400);
    }

    $stmt = $db->prepare("UPDATE users SET vault_session_preference = ? WHERE id = ?");
    $stmt->execute([$preference, $userId]);

    Response::success(['message' => 'Vault session preference updated.']);
}

// ---------------------------------------------------------------------------
// POST ?action=lock — Lock vault (clear HttpOnly cookie)
// ---------------------------------------------------------------------------
if ($method === 'POST' && $action === 'lock') {
    Encryption::clearDataTokenCookie();
    Response::success(['message' => 'Vault locked.']);
}

// ---------------------------------------------------------------------------
// Fallback — Invalid request
// ---------------------------------------------------------------------------
Response::error('Invalid request.', 400);
