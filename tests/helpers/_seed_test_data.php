<?php
/**
 * Seed admin user for API tests.
 * Called by apiTestServer.js after schema + migrations + seed SQL.
 * The only thing not in the SQL scripts is the admin user
 * (created manually per setup docs, not hardcoded in seed).
 *
 * Usage: php _seed_test_data.php <db_name> <db_user>
 */
$dbName = $argv[1] ?? 'citadel_vault_test_db';
$dbUser = $argv[2] ?? 'nitinkum';

$pdo = new PDO("mysql:host=localhost;dbname=$dbName", $dbUser, '');
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

// Admin user — matches apiClient.js TEST_USERS.admin
$hash = password_hash('TestAdmin123', PASSWORD_BCRYPT, ['cost' => 12]);

$stmt = $pdo->prepare(
    'INSERT INTO users (username, email, password_hash, role, is_active, email_verified)
     VALUES (?, ?, ?, ?, 1, 1)
     ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash)'
);
$stmt->execute(['initial_user', 'admin@test.local', $hash, 'admin']);
