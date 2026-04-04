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
require_once __DIR__ . '/../core/Storage.php';

Response::setCors();

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';
// ---------------------------------------------------------------------------
// POST ?action=create — Generate an invite link (any authenticated user)
// ---------------------------------------------------------------------------
if ($method === 'POST' && $action === 'create') {
    $payload = Auth::requireAuth();
    $userId = Auth::userId($payload);
    $body = Response::getBody();

    $email = Response::sanitize($body['email'] ?? '');

    if (!$email || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        Response::error('A valid email address is required.', 400);
    }

    // Check if email is already registered
    if (Storage::adapter()->checkEmailRegistered($email)) {
        Response::error('A user with this email already exists.', 409);
    }

    // Check for an existing unused, unexpired invite for this email
    $existing = Storage::adapter()->getExistingInvitation($email);

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
    $inviteExpiryDays = 7;
    try {
        $setting = Storage::adapter()->getSystemSetting('invite_expiry_days');
        if ($setting !== null) $inviteExpiryDays = (int)$setting;
    } catch (Exception $e) {}
    $expiresAt = date('Y-m-d H:i:s', time() + $inviteExpiryDays * 86400);

    Storage::adapter()->createInvitation([
        'token'      => $token,
        'email'      => $email,
        'invited_by' => $userId,
        'expires_at' => $expiresAt,
    ]);

    $origin = defined('APP_URL') ? APP_URL : (defined('WEBAUTHN_ORIGIN') ? WEBAUTHN_ORIGIN : 'http://localhost:8080');
    $inviteUrl = $origin . '/register?invite=' . $token;

    // Send invite email if SMTP is enabled
    $emailSent = false;
    if (defined('SMTP_ENABLED') && SMTP_ENABLED) {
        // Get inviter's username
        $inviterName = Storage::adapter()->getUsernameById($userId) ?: 'Someone';

        $result = Mailer::sendInvite($email, $inviteUrl, $inviterName);
        $emailSent = ($result['success'] ?? false);
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

    $invite = Storage::adapter()->validateInviteToken($token);

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
    $userId = Auth::userId($payload);
    $isSiteAdmin = $payload['role'] === 'admin';

    if ($isSiteAdmin) {
        $rows = Storage::adapter()->getAllInvitations();
    } else {
        $rows = Storage::adapter()->getInvitationsByUser($userId);
    }

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
    $userId = Auth::userId($payload);
    $isSiteAdmin = $payload['role'] === 'admin';
    $id = isset($_GET['id']) ? (int)$_GET['id'] : 0;

    if (!$id) {
        Response::error('Invite ID is required.', 400);
    }

    $invite = Storage::adapter()->getInvitation($id);

    if (!$invite) {
        Response::error('Invite not found.', 404);
    }
    if ($invite['used_at']) {
        Response::error('Cannot revoke an already-used invite.', 400);
    }
    if (!$isSiteAdmin && (int)$invite['invited_by'] !== $userId) {
        Response::error('You can only revoke your own invites.', 403);
    }

    Storage::adapter()->deleteInvitation($id);

    Response::success(['message' => 'Invite revoked.']);
}

// ---------------------------------------------------------------------------
// POST ?action=request — Public: request an invite (sends email to admin)
// No auth required — this is for unauthenticated users on the register page
// Gated by invite_requests_enabled system setting (admin-controlled)
// ---------------------------------------------------------------------------
if ($method === 'POST' && $action === 'request') {
    // Check if invite requests are enabled (admin toggle)
    $requestsEnabled = Storage::adapter()->getSystemSetting('invite_requests_enabled');
    if ($requestsEnabled !== 'true') {
        Response::error('Invite requests are currently disabled.', 403);
    }

    $body = Response::getBody();
    $email = Response::sanitize($body['email'] ?? '');
    $name  = Response::sanitize($body['name'] ?? '');

    if (!$email || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        Response::error('A valid email address is required.', 400);
    }

    // Rate limiting — per IP
    $ipHash = Auth::enforceIpRateLimit('invite_request', RATE_LIMIT_INVITE_REQ, RATE_LIMIT_INVITE_REQ_WINDOW);
    Auth::recordRateLimit('invite_request', $ipHash);

    // Check if this email already requested (UNIQUE constraint on invite_requests.email)
    if (Storage::adapter()->checkExistingInviteRequest($email)) {
        Response::error('A request for this email has already been submitted.', 409);
    }

    // Check if email is already registered
    if (Storage::adapter()->checkEmailRegistered($email)) {
        Response::error('An account with this email already exists. Try signing in.', 409);
    }

    // Check if there's already an active invite for this email
    if (Storage::adapter()->checkActiveInviteForEmail($email)) {
        Response::error('An invite has already been sent to this email. Please check your inbox.', 409);
    }

    // Record the request (tracks email + IP hash for audit)
    Storage::adapter()->createInviteRequest($email, $name ?: null, $ipHash);

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
