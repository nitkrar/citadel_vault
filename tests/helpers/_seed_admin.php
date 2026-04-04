<?php
/**
 * Seed admin user for API tests.
 * Called by apiTestServer.js to avoid shell escaping issues with $ in password.
 *
 * Usage: php _seed_admin.php <db_name> <db_user>
 */
$dbName = $argv[1] ?? 'citadel_vault_test_db';
$dbUser = $argv[2] ?? 'nitinkum';

$password = 'TestAdmin123';
$hash = password_hash($password, PASSWORD_BCRYPT, ['cost' => 12]);

$pdo = new PDO("mysql:host=localhost;dbname=$dbName", $dbUser, '');
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

$stmt = $pdo->prepare(
    'INSERT INTO users (username, email, password_hash, role, is_active, email_verified)
     VALUES (?, ?, ?, ?, 1, 1)
     ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash)'
);
$stmt->execute(['initial_user', 'admin@test.local', $hash, 'admin']);
