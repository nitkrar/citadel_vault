<?php
/**
 * Invitations API
 * Any authenticated user can generate invite links. Admins can also list/revoke.
 * Invite links are tied to a specific email and expire after 7 days.
 */
require_once __DIR__ . '/../core/Response.php';
require_once __DIR__ . '/../../config/config.php';
require_once __DIR__ . '/../core/Auth.php';
require_once __DIR__ . '/../core/Mailer.php';

Response::setCors();

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';
$db = Database::getConnection();

// ---------------------------------------------------------------------------
// POST ?action=create — Generate an invite link (any authenticated user)
// ---------------------------------------------------------------------------
if ($method === 'POST' && $action === 'create') {
    $payload = Auth::requireAuth();
    $userId = $payload['sub'];
    $body = Response::getBody();

    $email = Response::sanitize($body['email'] ?? '');

    if (!$email || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        Response::error('A valid email address is required.', 400);
    }

    // Check if email is already registered
    $stmt = $db->prepare("SELECT id FROM users WHERE email = ? LIMIT 1");
    $stmt->execute([$email]);
    if ($stmt->fetch()) {
        Response::error('A user with this email already exists.', 409);
    }

    // Check for an existing unused, unexpired invite for this email
    $stmt = $db->prepare(
        "SELECT id, token, expires_at FROM invitations
         WHERE email = ? AND used_at IS NULL AND expires_at > NOW()
         ORDER BY created_at DESC LIMIT 1"
    );
    $stmt->execute([$email]);
    $existing = $stmt->fetch(PDO::FETCH_ASSOC);

    if ($existing) {
        // Return the existing invite link instead of creating a duplicate
        $origin = defined('APP_URL') ? APP_URL : (defined('WEBAUTHN_ORIGIN') ? WEBAUTHN_ORIGIN : 'http://localhost:8080');
        Response::success([
            'invite_url' => $origin . '/register?invite=' . $existing['token'],
            'email'      => $email,
            'expires_at' => $existing['expires_at'],
            'reused'     => true,
        ]);
    }

    // Generate invite
    $token = bin2hex(random_bytes(32));
    $expiresAt = date('Y-m-d H:i:s', time() + 7 * 86400); // 7 days

    $stmt = $db->prepare(
        "INSERT INTO invitations (token, email, invited_by, expires_at) VALUES (?, ?, ?, ?)"
    );
    $stmt->execute([$token, $email, $userId, $expiresAt]);

    $origin = defined('APP_URL') ? APP_URL : (defined('WEBAUTHN_ORIGIN') ? WEBAUTHN_ORIGIN : 'http://localhost:8080');
    $inviteUrl = $origin . '/register?invite=' . $token;

    // Send invite email if SMTP is enabled
    $emailSent = false;
    if (defined('SMTP_ENABLED') && SMTP_ENABLED) {
        // Get inviter's username
        $stmt2 = $db->prepare("SELECT username FROM users WHERE id = ?");
        $stmt2->execute([$userId]);
        $inviterName = $stmt2->fetchColumn() ?: 'Someone';

        $result = Mailer::sendInvite($email, $inviteUrl, $inviterName);
        $emailSent = ($result === true);
    }

    Response::success([
        'invite_url'  => $inviteUrl,
        'email'       => $email,
        'expires_at'  => $expiresAt,
        'reused'      => false,
        'email_sent'  => $emailSent,
    ], 201);
}

// ---------------------------------------------------------------------------
// GET ?action=validate&token=xxx — Validate an invite token (public, no auth)
// ---------------------------------------------------------------------------
if ($method === 'GET' && $action === 'validate') {
    $token = $_GET['token'] ?? '';
    if (!$token) {
        Response::error('Invite token is required.', 400);
    }

    $stmt = $db->prepare(
        "SELECT i.email, i.expires_at, i.used_at, u.username AS invited_by_username
         FROM invitations i
         JOIN users u ON u.id = i.invited_by
         WHERE i.token = ? LIMIT 1"
    );
    $stmt->execute([$token]);
    $invite = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$invite) {
        Response::error('Invalid invite link.', 404);
    }
    if ($invite['used_at']) {
        Response::error('This invite has already been used.', 410);
    }
    if (strtotime($invite['expires_at']) < time()) {
        Response::error('This invite has expired.', 410);
    }

    Response::success([
        'email'               => $invite['email'],
        'invited_by'          => $invite['invited_by_username'],
        'expires_at'          => $invite['expires_at'],
    ]);
}

// ---------------------------------------------------------------------------
// GET ?action=list — List invites created by the current user (or all for admin)
// ---------------------------------------------------------------------------
if ($method === 'GET' && $action === 'list') {
    $payload = Auth::requireAuth();
    $userId = $payload['sub'];
    $isSiteAdmin = $payload['role'] === 'admin';

    if ($isSiteAdmin) {
        $stmt = $db->query(
            "SELECT i.id, i.email, i.token, i.expires_at, i.used_at, i.created_at,
                    u.username AS invited_by_username
             FROM invitations i
             JOIN users u ON u.id = i.invited_by
             ORDER BY i.created_at DESC LIMIT 100"
        );
    } else {
        $stmt = $db->prepare(
            "SELECT id, email, token, expires_at, used_at, created_at
             FROM invitations WHERE invited_by = ?
             ORDER BY created_at DESC LIMIT 50"
        );
        $stmt->execute([$userId]);
    }

    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

    // Add status field
    foreach ($rows as &$row) {
        if ($row['used_at']) {
            $row['status'] = 'used';
        } elseif (strtotime($row['expires_at']) < time()) {
            $row['status'] = 'expired';
        } else {
            $row['status'] = 'pending';
        }
    }
    unset($row);

    Response::success($rows);
}

// ---------------------------------------------------------------------------
// DELETE ?action=revoke&id=xxx — Revoke an unused invite
// ---------------------------------------------------------------------------
if ($method === 'DELETE' && $action === 'revoke') {
    $payload = Auth::requireAuth();
    $userId = $payload['sub'];
    $isSiteAdmin = $payload['role'] === 'admin';
    $id = isset($_GET['id']) ? (int)$_GET['id'] : 0;

    if (!$id) {
        Response::error('Invite ID is required.', 400);
    }

    $stmt = $db->prepare("SELECT id, invited_by, used_at FROM invitations WHERE id = ?");
    $stmt->execute([$id]);
    $invite = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$invite) {
        Response::error('Invite not found.', 404);
    }
    if ($invite['used_at']) {
        Response::error('Cannot revoke an already-used invite.', 400);
    }
    if (!$isSiteAdmin && (int)$invite['invited_by'] !== $userId) {
        Response::error('You can only revoke your own invites.', 403);
    }

    $stmt = $db->prepare("DELETE FROM invitations WHERE id = ?");
    $stmt->execute([$id]);

    Response::success(['message' => 'Invite revoked.']);
}

// ---------------------------------------------------------------------------
// POST ?action=request — Public: request an invite (sends email to admin)
// No auth required — this is for unauthenticated users on the register page
// ---------------------------------------------------------------------------
if ($method === 'POST' && $action === 'request') {
    $body = Response::getBody();
    $email = Response::sanitize($body['email'] ?? '');
    $name  = Response::sanitize($body['name'] ?? '');

    if (!$email || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        Response::error('A valid email address is required.', 400);
    }

    // Rate limiting — 3 requests per hour per IP
    $ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
    $ipHash = Auth::hashForRateLimit('invite_request_ip', $ip);
    if (Auth::isRateLimited($db, 'invite_request', $ipHash, RATE_LIMIT_INVITE_REQ, RATE_LIMIT_INVITE_REQ_WINDOW)) {
        Response::error('Too many invite requests. Please try again later.', 429);
    }
    Auth::recordRateLimit($db, 'invite_request', $ipHash);

    // Check if email is already registered
    $stmt = $db->prepare("SELECT id FROM users WHERE email = ? LIMIT 1");
    $stmt->execute([$email]);
    if ($stmt->fetch()) {
        Response::error('An account with this email already exists. Try signing in.', 409);
    }

    // Check if there's already an active invite for this email
    $stmt = $db->prepare(
        "SELECT id FROM invitations WHERE email = ? AND used_at IS NULL AND expires_at > NOW() LIMIT 1"
    );
    $stmt->execute([$email]);
    if ($stmt->fetch()) {
        Response::error('An invite has already been sent to this email. Please check your inbox or contact the person who invited you.', 409);
    }

    // Send request email to admin
    $adminEmail = defined('ADMIN_EMAIL') && ADMIN_EMAIL ? ADMIN_EMAIL : '';
    $sent = false;
    if (defined('SMTP_ENABLED') && SMTP_ENABLED && $adminEmail) {
        $result = Mailer::sendInviteRequest($adminEmail, $email, $name);
        $sent = $result['success'];
    }

    if ($sent) {
        Response::success(['message' => 'Your request has been sent to the administrator. You will receive an invite link at your email if approved.']);
    } else {
        Response::success(['message' => 'Your request has been submitted. The administrator will review it.']);
    }
}

// ---------------------------------------------------------------------------
// Fallback
// ---------------------------------------------------------------------------
Response::error('Invalid request.', 400);
