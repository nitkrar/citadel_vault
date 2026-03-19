<?php
/**
 * Personal Vault — Configuration
 * Loads .env file and defines application constants.
 */

// Load .env file (custom parser, no Composer)
$envFile = __DIR__ . '/.env';
if (file_exists($envFile)) {
    $lines = file($envFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    foreach ($lines as $line) {
        $line = trim($line);
        if ($line === '' || $line[0] === '#') continue;
        if (strpos($line, '=') === false) continue;
        [$key, $value] = explode('=', $line, 2);
        $key = trim($key);
        $value = trim($value);
        // Remove surrounding quotes
        if ((substr($value, 0, 1) === '"' && substr($value, -1) === '"') ||
            (substr($value, 0, 1) === "'" && substr($value, -1) === "'")) {
            $value = substr($value, 1, -1);
        } else {
            // Strip inline comments (only for unquoted values)
            // e.g., "DB_PASS=secret  # my password" → "secret"
            $commentPos = strpos($value, ' #');
            if ($commentPos !== false) {
                $value = trim(substr($value, 0, $commentPos));
            }
        }
        if (!isset($_ENV[$key]) && getenv($key) === false) {
            putenv("$key=$value");
            $_ENV[$key] = $value;
        }
    }
}

// Helper to read env vars with defaults
function env(string $key, $default = null) {
    $val = getenv($key);
    if ($val === false) $val = $_ENV[$key] ?? null;
    return $val !== null && $val !== '' ? $val : $default;
}

// Error reporting
$appEnv = env('APP_ENV', 'production');
if ($appEnv === 'development') {
    error_reporting(E_ALL);
    ini_set('display_errors', '1');
} else {
    error_reporting(0);
    ini_set('display_errors', '0');
}

// Database
define('DB_HOST', env('DB_HOST', 'localhost'));
define('DB_PORT', (int)env('DB_PORT', 3306));
define('DB_NAME', env('DB_NAME', 'citadel_vault_db'));
define('DB_USER', env('DB_USER', 'root'));
define('DB_PASS', env('DB_PASS', ''));

// JWT
define('JWT_SECRET', env('JWT_SECRET', ''));
define('JWT_EXPIRY', (int)env('JWT_EXPIRY', 28800)); // 8 hours

// Audit HMAC (for hashing IPs in audit log)
define('AUDIT_HMAC_SECRET', env('AUDIT_HMAC_SECRET', ''));

// Sharing token HMAC (signs recipient tokens for the share flow)
define('SHARING_TOKEN_SECRET', env('SHARING_TOKEN_SECRET', ''));

// Storage adapter
define('STORAGE_ADAPTER', env('STORAGE_ADAPTER', 'mariadb'));

// WebAuthn
define('WEBAUTHN_RP_ID', env('WEBAUTHN_RP_ID', 'localhost'));
define('WEBAUTHN_RP_NAME', env('WEBAUTHN_RP_NAME', 'Personal Vault'));
define('WEBAUTHN_ORIGIN', env('WEBAUTHN_ORIGIN', 'http://localhost:8080'));

// External APIs
define('EXCHANGE_RATE_API_KEY', env('EXCHANGE_RATE_API_KEY', ''));
define('ALPHA_VANTAGE_API_KEY', env('ALPHA_VANTAGE_API_KEY', 'demo'));

// Plaid
define('PLAID_CLIENT_ID', env('PLAID_CLIENT_ID', ''));
define('PLAID_SECRET', env('PLAID_SECRET', ''));
define('PLAID_ENV', env('PLAID_ENV', 'sandbox'));
define('PLAID_ENCRYPTION_KEY', env('PLAID_ENCRYPTION_KEY', ''));
define('PLAID_BASE_URL', match(PLAID_ENV) {
    'production'  => 'https://production.plaid.com',
    'development' => 'https://development.plaid.com',
    default       => 'https://sandbox.plaid.com',
});

// Application
define('APP_URL', env('APP_URL', WEBAUTHN_ORIGIN)); // Base URL for links (emails, invites)
define('BASE_CURRENCY', env('BASE_CURRENCY', 'GBP'));
define('ALLOWED_ORIGINS', env('ALLOWED_ORIGINS', 'https://localhost'));

// ---------------------------------------------------------------------------
// PRODUCTION SAFETY — fail-closed if critical secrets are missing or default
// In development mode these are warnings; in production the app refuses to start.
// ---------------------------------------------------------------------------
$_criticalErrors = [];
if (!JWT_SECRET) {
    $_criticalErrors[] = 'JWT_SECRET is not set. Run: openssl rand -hex 64';
}
if (!AUDIT_HMAC_SECRET) {
    $_criticalErrors[] = 'AUDIT_HMAC_SECRET is not set. Run: openssl rand -hex 32';
}
if (!SHARING_TOKEN_SECRET) {
    $_criticalErrors[] = 'SHARING_TOKEN_SECRET is not set. Run: openssl rand -hex 32';
}
if (!DB_PASS) {
    $_criticalErrors[] = 'DB_PASS is not set.';
}
if (ALLOWED_ORIGINS === '*' && $appEnv !== 'development') {
    $_criticalErrors[] = 'ALLOWED_ORIGINS is set to * (wildcard). Set it to your domain in production.';
}

if (!empty($_criticalErrors)) {
    if ($appEnv !== 'development') {
        // Production: hard stop
        http_response_code(500);
        header('Content-Type: text/plain');
        die("FATAL: Citadel cannot start. Fix these configuration errors:\n\n- " . implode("\n- ", $_criticalErrors) . "\n\nSee config/.env.example for reference.");
    } else {
        // Development: log warnings but continue
        foreach ($_criticalErrors as $err) {
            error_log("[Citadel Config Warning] $err");
        }
    }
}
unset($_criticalErrors);

// Vault key policy (client-side enforcement only — server doesn't validate vault keys)
// These constants are kept for backward compatibility with auth.php registration
define('VAULT_KEY_MIN_LENGTH', (int)env('VAULT_KEY_MIN_LENGTH', 8));
define('VAULT_KEY_MODE', env('VAULT_KEY_MODE', 'alphanumeric'));

// Encryption tuning (client-side only — kept for reference)
define('BCRYPT_COST', (int)env('BCRYPT_COST', 12));

// Branding
define('APP_NAME', env('APP_NAME', 'Personal Vault'));
define('APP_TAGLINE', env('APP_TAGLINE', 'Secure Personal Hub'));

// Sync polling
define('SYNC_POLL_INTERVAL', (int)env('SYNC_POLL_INTERVAL', 900)); // 15 minutes

// Registration
define('SELF_REGISTRATION', filter_var(env('SELF_REGISTRATION', 'false'), FILTER_VALIDATE_BOOLEAN));
define('REQUIRE_EMAIL_VERIFICATION', filter_var(env('REQUIRE_EMAIL_VERIFICATION', 'false'), FILTER_VALIDATE_BOOLEAN));

// Password policy
define('PASSWORD_HISTORY_COUNT', (int)env('PASSWORD_HISTORY_COUNT', 1));

// Account lockout (progressive — for login, not vault key)
define('LOCKOUT_TIER1_ATTEMPTS', (int)env('LOCKOUT_TIER1_ATTEMPTS', 3));
define('LOCKOUT_TIER1_DURATION', (int)env('LOCKOUT_TIER1_DURATION', 900));
define('LOCKOUT_TIER2_ATTEMPTS', (int)env('LOCKOUT_TIER2_ATTEMPTS', 6));
define('LOCKOUT_TIER2_DURATION', (int)env('LOCKOUT_TIER2_DURATION', 3600));
define('LOCKOUT_TIER3_ATTEMPTS', (int)env('LOCKOUT_TIER3_ATTEMPTS', 9));

// Rate limiting
define('RATE_LIMIT_LOGIN_IP', (int)env('RATE_LIMIT_LOGIN_IP', 20));
define('RATE_LIMIT_LOGIN_IP_WINDOW', (int)env('RATE_LIMIT_LOGIN_IP_WINDOW', 900));
define('RATE_LIMIT_REGISTER', (int)env('RATE_LIMIT_REGISTER', 5));
define('RATE_LIMIT_REGISTER_WINDOW', (int)env('RATE_LIMIT_REGISTER_WINDOW', 3600));
define('RATE_LIMIT_FORGOT_PW', (int)env('RATE_LIMIT_FORGOT_PW', 5));
define('RATE_LIMIT_FORGOT_PW_WINDOW', (int)env('RATE_LIMIT_FORGOT_PW_WINDOW', 3600));
define('RATE_LIMIT_INVITE_REQ', (int)env('RATE_LIMIT_INVITE_REQ', 3));
define('RATE_LIMIT_INVITE_REQ_WINDOW', (int)env('RATE_LIMIT_INVITE_REQ_WINDOW', 3600));

// SMTP Email
define('SMTP_HOST', env('SMTP_HOST', ''));
define('SMTP_PORT', (int)env('SMTP_PORT', 587));
define('SMTP_USER', env('SMTP_USER', ''));
define('SMTP_PASS', env('SMTP_PASS', ''));
define('SMTP_FROM', env('SMTP_FROM', ''));
define('SMTP_FROM_NAME', env('SMTP_FROM_NAME', 'Citadel Vault'));
define('SMTP_ENCRYPTION', env('SMTP_ENCRYPTION', 'tls'));
define('SMTP_ENABLED', filter_var(env('SMTP_ENABLED', 'false'), FILTER_VALIDATE_BOOLEAN));

// Admin contact
define('ADMIN_EMAIL', env('ADMIN_EMAIL', ''));

// Load database class
require_once __DIR__ . '/database.php';
