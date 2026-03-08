<?php
/**
 * Citadel Vault — Mailer
 * Lightweight SMTP email sender using PHP sockets (no Composer dependencies).
 * Supports STARTTLS on port 587. Based on battle-tested Shoonya BMS pattern.
 */
class Mailer {

    /**
     * Send an HTML email via SMTP.
     * Returns ['success' => bool, 'error' => ?string]
     */
    public static function send(string $to, string $subject, string $htmlBody, ?string $toName = null): array {
        $host     = defined('SMTP_HOST') ? SMTP_HOST : '';
        $port     = defined('SMTP_PORT') ? (int)SMTP_PORT : 587;
        $user     = defined('SMTP_USER') ? SMTP_USER : '';
        $pass     = defined('SMTP_PASS') ? SMTP_PASS : '';
        $from     = defined('SMTP_FROM') ? SMTP_FROM : '';
        $fromName = defined('SMTP_FROM_NAME') ? SMTP_FROM_NAME : 'Citadel Vault';

        if (!$host || !$user || !$pass || !$from) {
            return ['success' => false, 'error' => 'SMTP not configured.'];
        }

        try {
            $smtp = @fsockopen($host, $port, $errno, $errstr, 10);
            if (!$smtp) {
                throw new Exception("Connection failed: {$errstr} ({$errno})");
            }
            stream_set_timeout($smtp, 10);

            self::smtpRead($smtp, 220);
            self::smtpCommand($smtp, "EHLO " . gethostname(), 250);

            // STARTTLS
            self::smtpCommand($smtp, "STARTTLS", 220);
            $crypto = stream_socket_enable_crypto($smtp, true,
                STREAM_CRYPTO_METHOD_TLSv1_2_CLIENT | STREAM_CRYPTO_METHOD_TLSv1_3_CLIENT);
            if (!$crypto) {
                throw new Exception("STARTTLS negotiation failed");
            }
            self::smtpCommand($smtp, "EHLO " . gethostname(), 250);

            // AUTH LOGIN
            self::smtpCommand($smtp, "AUTH LOGIN", 334);
            self::smtpCommand($smtp, base64_encode($user), 334);
            self::smtpCommand($smtp, base64_encode($pass), 235);

            // Envelope
            self::smtpCommand($smtp, "MAIL FROM:<{$from}>", 250);
            self::smtpCommand($smtp, "RCPT TO:<{$to}>", 250);
            self::smtpCommand($smtp, "DATA", 354);

            // Build message headers + body
            $fromHeader = "=?UTF-8?B?" . base64_encode($fromName) . "?= <{$from}>";
            $toHeader = $toName ? "=?UTF-8?B?" . base64_encode($toName) . "?= <{$to}>" : $to;
            $subjectEncoded = "=?UTF-8?B?" . base64_encode($subject) . "?=";

            $message  = "From: {$fromHeader}\r\n";
            $message .= "To: {$toHeader}\r\n";
            $message .= "Subject: {$subjectEncoded}\r\n";
            $message .= "MIME-Version: 1.0\r\n";
            $message .= "Content-Type: text/html; charset=UTF-8\r\n";
            $message .= "Content-Transfer-Encoding: base64\r\n";
            $message .= "\r\n";
            $message .= chunk_split(base64_encode($htmlBody));
            $message .= "\r\n.";

            self::smtpCommand($smtp, $message, 250);
            self::smtpCommand($smtp, "QUIT", 221);

            fclose($smtp);
            return ['success' => true, 'error' => null];

        } catch (Exception $e) {
            if (isset($smtp) && is_resource($smtp)) {
                @fwrite($smtp, "QUIT\r\n");
                @fclose($smtp);
            }
            error_log("Citadel Mailer error: " . $e->getMessage());
            return ['success' => false, 'error' => $e->getMessage()];
        }
    }

    // =========================================================================
    // Email Templates
    // =========================================================================

    /**
     * Send an invite email.
     */
    public static function sendInvite(string $to, string $inviteUrl, string $invitedByUsername): array {
        $appName = defined('APP_NAME') ? APP_NAME : 'Citadel Vault';

        $html = self::wrapTemplate("
            <h2 style='color: #1d4ed8; margin: 0 0 16px;'>$appName</h2>
            <p>Hi,</p>
            <p><strong>$invitedByUsername</strong> has invited you to join $appName — a secure, encrypted personal vault.</p>
            <p style='margin: 24px 0;'>
                <a href='$inviteUrl' style='display: inline-block; padding: 12px 24px; background: #2563eb; color: #fff; text-decoration: none; border-radius: 8px; font-weight: 600;'>
                    Create Your Account
                </a>
            </p>
            <p style='color: #6b7280; font-size: 14px;'>This invite link expires in 7 days and can only be used once.</p>
            <p style='color: #6b7280; font-size: 14px;'>If you didn't expect this invite, you can safely ignore this email.</p>
        ");

        return self::send($to, "You've been invited to $appName", $html);
    }

    /**
     * Send an email verification link.
     */
    public static function sendVerification(string $to, string $verifyUrl, string $username): array {
        $appName = defined('APP_NAME') ? APP_NAME : 'Citadel Vault';

        $html = self::wrapTemplate("
            <h2 style='color: #1d4ed8; margin: 0 0 16px;'>$appName</h2>
            <p>Hi <strong>$username</strong>,</p>
            <p>Thank you for creating an account. Please verify your email address to complete your registration.</p>
            <p style='margin: 24px 0;'>
                <a href='$verifyUrl' style='display: inline-block; padding: 12px 24px; background: #2563eb; color: #fff; text-decoration: none; border-radius: 8px; font-weight: 600;'>
                    Verify Email Address
                </a>
            </p>
            <p style='color: #6b7280; font-size: 14px;'>This link expires in 24 hours.</p>
            <p style='color: #6b7280; font-size: 14px;'>If you didn't create this account, you can safely ignore this email.</p>
        ");

        return self::send($to, "Verify your email — $appName", $html);
    }

    /**
     * Send a welcome email when an admin creates an account.
     */
    public static function sendWelcome(string $to, string $username, string $tempPassword, string $loginUrl): array {
        $appName = defined('APP_NAME') ? APP_NAME : 'Citadel Vault';

        $html = self::wrapTemplate("
            <h2 style='color: #1d4ed8; margin: 0 0 16px;'>Welcome to $appName</h2>
            <p>Hi <strong>$username</strong>,</p>
            <p>An account has been created for you on $appName — a secure, encrypted personal vault.</p>
            <p>Here are your login credentials:</p>
            <table style='width: 100%; border-collapse: collapse; margin: 16px 0; background: #f9fafb; border-radius: 8px;'>
                <tr><td style='padding: 10px 14px; font-weight: 600; color: #6b7280; width: 120px;'>Username</td><td style='padding: 10px 14px; font-family: monospace;'>$username</td></tr>
                <tr><td style='padding: 10px 14px; font-weight: 600; color: #6b7280;'>Password</td><td style='padding: 10px 14px; font-family: monospace;'>$tempPassword</td></tr>
            </table>
            <p style='color: #dc2626; font-size: 14px; font-weight: 600;'>You will be asked to change your password on first login.</p>
            <p style='margin: 24px 0;'>
                <a href='$loginUrl/login' style='display: inline-block; padding: 12px 24px; background: #2563eb; color: #fff; text-decoration: none; border-radius: 8px; font-weight: 600;'>
                    Sign In
                </a>
            </p>
            <p style='color: #6b7280; font-size: 14px;'>After signing in, you will set up your vault key. Keep it safe — it protects all your data.</p>
        ");

        return self::send($to, "Your $appName account is ready", $html);
    }

    /**
     * Send an invite request notification to admin.
     */
    public static function sendInviteRequest(string $adminEmail, string $requesterEmail, string $requesterName): array {
        $appName = defined('APP_NAME') ? APP_NAME : 'Citadel Vault';
        $displayName = $requesterName ?: 'Not provided';

        $html = self::wrapTemplate("
            <h2 style='color: #1d4ed8; margin: 0 0 16px;'>$appName — Invite Request</h2>
            <p>Someone has requested an invite to $appName.</p>
            <table style='width: 100%; border-collapse: collapse; margin: 16px 0;'>
                <tr><td style='padding: 8px; font-weight: 600; color: #6b7280;'>Name</td><td style='padding: 8px;'>$displayName</td></tr>
                <tr><td style='padding: 8px; font-weight: 600; color: #6b7280;'>Email</td><td style='padding: 8px;'><a href='mailto:$requesterEmail'>$requesterEmail</a></td></tr>
                <tr><td style='padding: 8px; font-weight: 600; color: #6b7280;'>Requested</td><td style='padding: 8px;'>" . date('Y-m-d H:i:s') . " UTC</td></tr>
            </table>
            <p>Log in to the admin panel and generate an invite link for <strong>$requesterEmail</strong>.</p>
        ");

        return self::send($adminEmail, "Invite Request — $appName", $html);
    }

    /**
     * Send account lockout notification.
     * IP is included in the email (transient) but NOT stored in the database.
     */
    public static function sendLockoutNotification(string $to, string $username, int $attempts, ?string $ip, ?string $lockDuration): array {
        $appName = defined('APP_NAME') ? APP_NAME : 'Citadel Vault';
        $ipDisplay = $ip ? htmlspecialchars($ip) : 'Unknown';
        $time = date('Y-m-d H:i:s T');

        $lockMessage = $lockDuration
            ? "Your account has been temporarily locked for <strong>$lockDuration</strong>."
            : "Your account has been <strong>locked</strong>. You will need to change your password to regain access.";

        $html = self::wrapTemplate("
            <h2 style='color: #dc2626; margin: 0 0 16px;'>Security Alert — $appName</h2>
            <p>Hi <strong>$username</strong>,</p>
            <p>We detected <strong>$attempts failed login attempts</strong> on your account.</p>
            <p>$lockMessage</p>
            <table style='width: 100%; border-collapse: collapse; margin: 16px 0; background: #fef2f2; border-radius: 8px;'>
                <tr><td style='padding: 10px 14px; font-weight: 600; color: #6b7280; width: 120px;'>Time</td><td style='padding: 10px 14px;'>$time</td></tr>
                <tr><td style='padding: 10px 14px; font-weight: 600; color: #6b7280;'>IP Address</td><td style='padding: 10px 14px; font-family: monospace;'>$ipDisplay</td></tr>
                <tr><td style='padding: 10px 14px; font-weight: 600; color: #6b7280;'>Attempts</td><td style='padding: 10px 14px;'>$attempts</td></tr>
            </table>
            <p style='color: #6b7280; font-size: 14px;'>If this was you, wait for the lockout to expire and try again with the correct password. If this wasn't you, consider changing your password immediately using your recovery key.</p>
        ");

        return self::send($to, "Security Alert: Account locked — $appName", $html);
    }

    // =========================================================================
    // Helpers
    // =========================================================================

    private static function wrapTemplate(string $content): string {
        $appName = defined('APP_NAME') ? APP_NAME : 'Citadel Vault';
        return "
        <div style='font-family: -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px;'>
            $content
            <hr style='border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;' />
            <p style='color: #9ca3af; font-size: 12px;'>$appName — Your Personal Encrypted Vault</p>
        </div>";
    }

    private static function smtpCommand($smtp, string $command, int $expectedCode): string {
        fwrite($smtp, $command . "\r\n");
        return self::smtpRead($smtp, $expectedCode);
    }

    private static function smtpRead($smtp, int $expectedCode): string {
        $response = '';
        while ($line = fgets($smtp, 512)) {
            $response .= $line;
            if (isset($line[3]) && $line[3] === ' ') break;
        }
        $code = intval(substr($response, 0, 3));
        if ($code !== $expectedCode) {
            throw new Exception("Expected {$expectedCode}, got: " . trim($response));
        }
        return $response;
    }
}
