<?php
/**
 * Citadel Vault — Sharing API (Client-Side Encryption)
 *
 * Blind share model: never reveals whether a user exists.
 * Ghost shares: RSA key pair generated, private key discarded = unrecoverable.
 * All encrypted data is opaque to the server.
 */
require_once __DIR__ . '/../core/Response.php';
require_once __DIR__ . '/../../config/config.php';
require_once __DIR__ . '/../core/Auth.php';
require_once __DIR__ . '/../core/Storage.php';
require_once __DIR__ . '/../core/Encryption.php';
require_once __DIR__ . '/../core/SharingToken.php';

Response::setCors();

$payload = Auth::requireAuth();
$userId = $payload['sub'];
$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? null;
$storage = Storage::adapter();
$db = Database::getInstance();

// ---------------------------------------------------------------------------
// GET ?action=recipient-key&identifier=X — Resolve recipient, return public key + signed token
// Never 404. If user doesn't exist, uses global ghost user (id=0).
// ---------------------------------------------------------------------------
if ($method === 'GET' && $action === 'recipient-key') {
    $identifier = trim($_GET['identifier'] ?? '');
    if (empty($identifier)) {
        Response::error('identifier parameter is required.', 400);
    }

    // Don't allow sharing with yourself
    $stmt = $db->prepare("SELECT id, username, email FROM users WHERE id = ?");
    $stmt->execute([$userId]);
    $self = $stmt->fetch(PDO::FETCH_ASSOC);
    if ($self && ($identifier === $self['username'] || $identifier === $self['email'])) {
        Response::error('Cannot share with yourself.', 400);
    }

    // Try to find real user by username or email
    $stmt = $db->prepare(
        "SELECT u.id, uvk.public_key
         FROM users u
         LEFT JOIN user_vault_keys uvk ON u.id = uvk.user_id
         WHERE (u.username = ? OR u.email = ?) AND u.is_active = 1 AND u.role != 'ghost'"
    );
    $stmt->execute([$identifier, $identifier]);
    $recipient = $stmt->fetch(PDO::FETCH_ASSOC);

    if ($recipient && !empty($recipient['public_key'])) {
        Response::success([
            'public_key'      => $recipient['public_key'],
            'is_ghost'        => false,
            'recipient_token' => SharingToken::generate((int)$recipient['id']),
        ]);
    }

    // No real user found — use global ghost user (id=0)
    // Check if ghost already has a public key
    $ghostKeys = $storage->getVaultKeys(0);
    if ($ghostKeys && !empty($ghostKeys['public_key'])) {
        Response::success([
            'public_key'      => $ghostKeys['public_key'],
            'is_ghost'        => true,
            'recipient_token' => SharingToken::generate(0),
        ]);
    }

    // Ghost has no key yet — generate RSA keypair, discard private key
    $config = [
        'private_key_bits' => 2048,
        'private_key_type' => OPENSSL_KEYTYPE_RSA,
    ];
    $res = openssl_pkey_new($config);
    $details = openssl_pkey_get_details($res);
    $ghostPublicKeyPem = $details['key'];

    // Convert PEM to base64 DER (SPKI) for client-side format
    $pemLines = explode("\n", trim($ghostPublicKeyPem));
    $derBase64 = '';
    foreach ($pemLines as $line) {
        if (strpos($line, '-----') === false) {
            $derBase64 .= $line;
        }
    }

    // Store ghost's public key (private key discarded — unrecoverable by design)
    $storage->setVaultKeys(0, ['public_key' => $derBase64]);

    Response::success([
        'public_key'      => $derBase64,
        'is_ghost'        => true,
        'recipient_token' => SharingToken::generate(0),
    ]);
}

// ---------------------------------------------------------------------------
// POST ?action=share — Batch share entry with recipients (token-based)
// Accepts signed recipient_token from recipient-key, not raw identifiers.
// Upserts: re-sharing with same recipient updates the encrypted blob.
// ---------------------------------------------------------------------------
if ($method === 'POST' && $action === 'share') {
    $body = Response::getBody();
    $sourceEntryId = (int)($body['source_entry_id'] ?? 0);
    $recipients = $body['recipients'] ?? [];

    if (!$sourceEntryId) {
        Response::error('source_entry_id is required.', 400);
    }
    if (!is_array($recipients) || empty($recipients)) {
        Response::error('recipients array is required.', 400);
    }

    // Verify sender owns the entry
    $entry = $storage->getEntry($userId, $sourceEntryId);
    if (!$entry) {
        Response::error('Entry not found.', 404);
    }

    $created = [];
    $skipped = 0;
    foreach ($recipients as $r) {
        $token = $r['recipient_token'] ?? '';
        $encryptedData = $r['encrypted_data'] ?? '';

        if (empty($token) || empty($encryptedData)) {
            $skipped++;
            continue;
        }

        // Validate signed token — extracts recipient_id, checks HMAC + expiry
        $recipientId = SharingToken::validate($token);
        if ($recipientId === null) {
            $skipped++;
            continue; // expired or tampered token
        }

        // Self-share check (belt-and-suspenders — recipient-key also blocks this)
        if ($recipientId === $userId) {
            $skipped++;
            continue;
        }

        // Determine ghost status and get display identifier
        $isGhost = ($recipientId === 0) ? 1 : 0;
        $recipientIdentifier = 'unknown';
        $stmt = $db->prepare("SELECT username FROM users WHERE id = ?");
        $stmt->execute([$recipientId]);
        $recipientUser = $stmt->fetch(PDO::FETCH_ASSOC);
        if ($recipientUser) {
            $recipientIdentifier = $recipientUser['username'];
        }

        // Upsert: creates or updates share on same (sender, entry, recipient)
        $shareId = $storage->upsertShare([
            'sender_id'            => $userId,
            'recipient_identifier' => $recipientIdentifier,
            'recipient_id'         => $recipientId,
            'source_entry_id'      => $sourceEntryId,
            'entry_type'           => $entry['entry_type'],
            'template_id'          => $entry['template_id'] ?? null,
            'encrypted_data'       => $encryptedData,
            'is_ghost'             => $isGhost,
        ]);
        $created[] = $shareId;
    }

    $ipHash = Encryption::hashIp($_SERVER['REMOTE_ADDR'] ?? null);
    $storage->logAction($userId, 'share_created', 'vault_entry', $sourceEntryId, $ipHash);

    Response::success(['share_ids' => $created, 'count' => count($created), 'skipped' => $skipped]);
}

// ---------------------------------------------------------------------------
// POST ?action=update — Batch re-encrypt shares (on-edit re-share)
// ---------------------------------------------------------------------------
if ($method === 'POST' && $action === 'update') {
    $body = Response::getBody();
    $sourceEntryId = (int)($body['source_entry_id'] ?? 0);
    $recipients = $body['recipients'] ?? [];

    if (!$sourceEntryId || !is_array($recipients) || empty($recipients)) {
        Response::error('source_entry_id and recipients array required.', 400);
    }

    // Verify sender owns the source entry
    $entry = $storage->getEntry($userId, $sourceEntryId);
    if (!$entry) {
        Response::error('Entry not found.', 404);
    }

    $updated = 0;
    foreach ($recipients as $r) {
        $shareUserId = (int)($r['user_id'] ?? 0);
        $encryptedData = $r['encrypted_data'] ?? '';
        if (!$shareUserId || empty($encryptedData)) continue;

        // Find the share by sender + source_entry + recipient
        $stmt = $db->prepare(
            "SELECT id FROM shared_items
             WHERE sender_id = ? AND source_entry_id = ? AND recipient_id = ?"
        );
        $stmt->execute([$userId, $sourceEntryId, $shareUserId]);
        $share = $stmt->fetch(PDO::FETCH_ASSOC);

        if ($share) {
            $storage->updateShare((int)$share['id'], $encryptedData);
            $updated++;
        }
    }

    Response::success(['updated' => $updated]);
}

// ---------------------------------------------------------------------------
// POST ?action=revoke — Revoke shares
// ---------------------------------------------------------------------------
if ($method === 'POST' && $action === 'revoke') {
    $body = Response::getBody();
    $sourceEntryId = (int)($body['source_entry_id'] ?? 0);
    $userIds = $body['user_ids'] ?? [];

    if (!$sourceEntryId) {
        Response::error('source_entry_id is required.', 400);
    }

    if (empty($userIds)) {
        // Revoke all shares for this entry
        $stmt = $db->prepare(
            "SELECT id FROM shared_items WHERE sender_id = ? AND source_entry_id = ?"
        );
        $stmt->execute([$userId, $sourceEntryId]);
        $shares = $stmt->fetchAll(PDO::FETCH_ASSOC);

        $revoked = 0;
        foreach ($shares as $share) {
            $storage->deleteShare($userId, (int)$share['id']);
            $revoked++;
        }
    } else {
        // Revoke specific recipients
        $revoked = 0;
        foreach ($userIds as $recipientId) {
            $stmt = $db->prepare(
                "SELECT id FROM shared_items
                 WHERE sender_id = ? AND source_entry_id = ? AND recipient_id = ?"
            );
            $stmt->execute([$userId, $sourceEntryId, (int)$recipientId]);
            $share = $stmt->fetch(PDO::FETCH_ASSOC);
            if ($share) {
                $storage->deleteShare($userId, (int)$share['id']);
                $revoked++;
            }
        }
    }

    $ipHash = Encryption::hashIp($_SERVER['REMOTE_ADDR'] ?? null);
    $storage->logAction($userId, 'share_revoked', 'vault_entry', $sourceEntryId, $ipHash);

    Response::success(['revoked' => $revoked]);
}

// ---------------------------------------------------------------------------
// GET ?action=shared-by-me — Sender's outbox
// ---------------------------------------------------------------------------
if ($method === 'GET' && $action === 'shared-by-me') {
    $shares = $storage->getSharedByMe($userId);
    Response::success($shares);
}

// ---------------------------------------------------------------------------
// GET ?action=shared-with-me — Recipient's inbox
// ---------------------------------------------------------------------------
if ($method === 'GET' && $action === 'shared-with-me') {
    $shares = $storage->getSharedWithMe($userId);
    Response::success($shares);
}

// ---------------------------------------------------------------------------
// GET ?action=share-count&entry_id=X — Count active shares for an entry
// ---------------------------------------------------------------------------
if ($method === 'GET' && $action === 'share-count') {
    $entryId = (int)($_GET['entry_id'] ?? 0);
    if (!$entryId) {
        Response::error('entry_id parameter is required.', 400);
    }

    $stmt = $db->prepare(
        "SELECT COUNT(*) FROM shared_items WHERE source_entry_id = ? AND sender_id = ?"
    );
    $stmt->execute([$entryId, $userId]);
    $count = (int)$stmt->fetchColumn();

    Response::success(['count' => $count]);
}

// ---------------------------------------------------------------------------
// Fallback
// ---------------------------------------------------------------------------
Response::error('Invalid request.', 400);
