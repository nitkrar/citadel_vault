<?php
/**
 * Comprehensive test data seed for API tests.
 * Called by apiTestServer.js after schema + seed SQL.
 *
 * Seeds everything tests need beyond what 02-seed.sql provides:
 *   - Admin user (initial_user / TestAdmin123)
 *   - Regular user (test_regular_user / TestRegular1)
 *   - Account types (11 system types, IDs 1-11)
 *   - System settings overrides for test environment
 *
 * Usage: php _seed_test_data.php <db_name> <db_user>
 */
$dbName = $argv[1] ?? 'citadel_vault_test_db';
$dbUser = $argv[2] ?? 'nitinkum';

$pdo = new PDO("mysql:host=localhost;dbname=$dbName", $dbUser, '');
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

// ─── Users ───────────────────────────────────────────────────────────────────

// Admin user — matches apiClient.js TEST_USERS.admin
$adminHash = password_hash('TestAdmin123', PASSWORD_BCRYPT, ['cost' => 12]);
$pdo->prepare(
    'INSERT INTO users (username, email, password_hash, role, is_active, email_verified)
     VALUES (?, ?, ?, ?, 1, 1)
     ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash)'
)->execute(['initial_user', 'admin@test.local', $adminHash, 'admin']);

// Regular user — matches apiClient.js TEST_USERS.regular
// Pre-seeded to eliminate fragile lazy creation via ensureRegularUser()
$regularHash = password_hash('TestRegular1', PASSWORD_BCRYPT, ['cost' => 12]);
$pdo->prepare(
    'INSERT INTO users (username, email, password_hash, role, is_active, email_verified, must_reset_password)
     VALUES (?, ?, ?, ?, 1, 1, 0)
     ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), must_reset_password = 0'
)->execute(['test_regular_user', 'regular@test.local', $regularHash, 'user']);

// ─── Account Types ───────────────────────────────────────────────────────────
// Required by account-detail-templates tests (IDs 1-11)

$accountTypes = [
    [1,  'Generic Account',       'Generic bank account type',       'bank',        1],
    [2,  'Checking Account',      'Checking account',                'bank',        1],
    [3,  'Savings Account',       'Savings account',                 'piggy-bank',  1],
    [4,  'Investment Account',    'Investment/brokerage account',    'trending-up', 1],
    [5,  'Credit Card Account',   'Credit card account',             'credit-card', 1],
    [6,  'Mortgage Account',      'Mortgage account',                'home',        1],
    [7,  'Loan Account',          'Loan account',                    'arrow-down',  1],
    [8,  'Money Market Account',  'Money market account',            'wallet',      1],
    [9,  'Certificate of Deposit','Certificate of Deposit (CD)',     'file-text',   1],
    [10, 'Retirement Account',    'Retirement/401k account',         'lock',        1],
    [11, 'Payment Account',       'Digital payment/wallet account',  'credit-card', 1],
];

$stmt = $pdo->prepare(
    'INSERT INTO account_types (id, name, description, icon, is_system)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE name = VALUES(name)'
);
foreach ($accountTypes as $row) {
    $stmt->execute($row);
}

// ─── System Settings Overrides ───────────────────────────────────────────────

// Enable invite requests (tests expect 200, not 403)
$pdo->exec("UPDATE system_settings SET setting_value = 'true' WHERE setting_key = 'invite_requests_enabled'");

// Add options JSON to ticker_price_ttl (settings test checks Array.isArray)
$ttlOptions = json_encode([
    ['value' => '3600',   'label' => '1 hour'],
    ['value' => '86400',  'label' => '24 hours'],
    ['value' => '604800', 'label' => '7 days'],
]);
$pdo->prepare("UPDATE system_settings SET options = ? WHERE setting_key = 'ticker_price_ttl'")->execute([$ttlOptions]);

// Fix worker_mode type (settings test expects gatekeeper, seed has config)
$pdo->exec("UPDATE system_settings SET type = 'gatekeeper' WHERE setting_key = 'worker_mode'");
