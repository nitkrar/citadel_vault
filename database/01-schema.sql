-- =============================================================================
-- Citadel Vault — Complete Database Schema
-- =============================================================================
-- Target: MariaDB / MySQL 8+ with InnoDB
-- Character Set: utf8mb4, Collation: utf8mb4_unicode_ci
--
-- Usage:
--   mysql -u root citadel_vault_db < 01-schema.sql
--   mysql -u root citadel_vault_db < 02-seed.sql
--   mysql -u root citadel_vault_db < 03-testdata.sql   (optional, for testing)
-- =============================================================================

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
SET time_zone = "+00:00";

-- =============================================================================
-- 1. USERS
-- =============================================================================
CREATE TABLE `users` (
    `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `username` VARCHAR(50) NOT NULL,
    `email` VARCHAR(255) NOT NULL,
    `password_hash` VARCHAR(255) NOT NULL,
    `role` ENUM('site_admin','user','ghost') NOT NULL DEFAULT 'user',
    `must_change_password` TINYINT(1) NOT NULL DEFAULT 0,
    `must_change_vault_key` TINYINT(1) NOT NULL DEFAULT 0,
    `admin_action_message` VARCHAR(500) DEFAULT NULL,
    `is_active` TINYINT(1) NOT NULL DEFAULT 1,
    `vault_key_salt` VARCHAR(255) DEFAULT NULL,
    `recovery_key_salt` VARCHAR(255) DEFAULT NULL,
    `encrypted_dek` TEXT DEFAULT NULL,
    `encrypted_dek_recovery` TEXT DEFAULT NULL,
    `recovery_key_encrypted` TEXT DEFAULT NULL,
    `has_vault_key` TINYINT(1) NOT NULL DEFAULT 0,
    `vault_session_preference` ENUM('session','timed','login') NOT NULL DEFAULT 'session',
    `encryption_mode` ENUM('server','client') NOT NULL DEFAULT 'server',
    `public_key` TEXT DEFAULT NULL,
    `encrypted_private_key` TEXT DEFAULT NULL,
    `failed_login_attempts` INT NOT NULL DEFAULT 0,
    `locked_until` TIMESTAMP NULL DEFAULT NULL,
    `last_failed_login_at` TIMESTAMP NULL DEFAULT NULL,
    `failed_vault_attempts` INT NOT NULL DEFAULT 0,
    `vault_locked_until` TIMESTAMP NULL DEFAULT NULL,
    `email_verified` TINYINT(1) NOT NULL DEFAULT 1,
    `email_verification_token` VARCHAR(128) DEFAULT NULL,
    `email_verification_expires` TIMESTAMP NULL DEFAULT NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_users_username` (`username`),
    UNIQUE KEY `uk_users_email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- 2. CURRENCIES
-- =============================================================================
CREATE TABLE `currencies` (
    `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL,
    `code` VARCHAR(10) NOT NULL,
    `symbol` VARCHAR(10) NOT NULL,
    `display_order` INT NOT NULL DEFAULT 999,
    `is_active` TINYINT(1) NOT NULL DEFAULT 1,
    `exchange_rate_to_base` DECIMAL(15,8) NOT NULL DEFAULT 1.00000000,
    `last_updated` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_currencies_code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- 3. COUNTRIES
-- =============================================================================
CREATE TABLE `countries` (
    `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL,
    `code` VARCHAR(10) NOT NULL,
    `flag_emoji` VARCHAR(10) DEFAULT NULL,
    `display_order` INT NOT NULL DEFAULT 999,
    `default_currency_id` INT UNSIGNED DEFAULT NULL,
    `field_template` JSON DEFAULT NULL,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_countries_code` (`code`),
    KEY `idx_countries_currency` (`default_currency_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- 4. ACCOUNT TYPES
-- =============================================================================
CREATE TABLE `account_types` (
    `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL,
    `description` TEXT DEFAULT NULL,
    `icon` VARCHAR(50) DEFAULT 'bank',
    `is_system` TINYINT(1) NOT NULL DEFAULT 0,
    `created_by` INT UNSIGNED DEFAULT NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_account_types_created_by` (`created_by`),
    CONSTRAINT `fk_account_types_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- 5. ACCOUNTS
-- =============================================================================
CREATE TABLE `accounts` (
    `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` INT UNSIGNED NOT NULL,
    `account_type_id` INT UNSIGNED NOT NULL,
    `subtype` VARCHAR(50) DEFAULT NULL,
    `name` TEXT NOT NULL,
    `institution` TEXT DEFAULT NULL,
    `country_id` INT UNSIGNED DEFAULT NULL,
    `currency_id` INT UNSIGNED NOT NULL,
    `customer_id` TEXT DEFAULT NULL,
    `account_details` TEXT DEFAULT NULL,
    `comments` TEXT DEFAULT NULL,
    `is_active` TINYINT(1) NOT NULL DEFAULT 1,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_accounts_user` (`user_id`),
    KEY `idx_accounts_type` (`account_type_id`),
    KEY `idx_accounts_country` (`country_id`),
    KEY `idx_accounts_currency` (`currency_id`),
    CONSTRAINT `fk_accounts_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_accounts_type` FOREIGN KEY (`account_type_id`) REFERENCES `account_types` (`id`),
    CONSTRAINT `fk_accounts_country` FOREIGN KEY (`country_id`) REFERENCES `countries` (`id`) ON DELETE SET NULL,
    CONSTRAINT `fk_accounts_currency` FOREIGN KEY (`currency_id`) REFERENCES `currencies` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- 6. ASSET TYPES
-- =============================================================================
CREATE TABLE `asset_types` (
    `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL,
    `category` VARCHAR(50) NOT NULL,
    `json_schema` TEXT DEFAULT NULL,
    `icon` VARCHAR(50) DEFAULT 'circle',
    `is_system` TINYINT(1) NOT NULL DEFAULT 0,
    `created_by` INT UNSIGNED DEFAULT NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_asset_types_created_by` (`created_by`),
    CONSTRAINT `fk_asset_types_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- 7. ASSETS
-- =============================================================================
CREATE TABLE `assets` (
    `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` INT UNSIGNED NOT NULL,
    `account_id` INT UNSIGNED DEFAULT NULL,
    `asset_type_id` INT UNSIGNED NOT NULL,
    `name` TEXT NOT NULL,
    `currency_id` INT UNSIGNED NOT NULL,
    `country_id` INT UNSIGNED DEFAULT NULL,
    `amount` TEXT NOT NULL,
    `is_liquid` TINYINT(1) NOT NULL DEFAULT 0,
    `is_liability` TINYINT(1) NOT NULL DEFAULT 0,
    `asset_data` TEXT DEFAULT NULL,
    `comments` TEXT DEFAULT NULL,
    `is_active` TINYINT(1) NOT NULL DEFAULT 1,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_assets_user` (`user_id`),
    KEY `idx_assets_account` (`account_id`),
    KEY `idx_assets_type` (`asset_type_id`),
    KEY `idx_assets_currency` (`currency_id`),
    KEY `idx_assets_country` (`country_id`),
    CONSTRAINT `fk_assets_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_assets_account` FOREIGN KEY (`account_id`) REFERENCES `accounts` (`id`) ON DELETE SET NULL,
    CONSTRAINT `fk_assets_type` FOREIGN KEY (`asset_type_id`) REFERENCES `asset_types` (`id`),
    CONSTRAINT `fk_assets_currency` FOREIGN KEY (`currency_id`) REFERENCES `currencies` (`id`),
    CONSTRAINT `fk_assets_country` FOREIGN KEY (`country_id`) REFERENCES `countries` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- 8. INSURANCE POLICIES
-- =============================================================================
CREATE TABLE `insurance_policies` (
    `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` INT UNSIGNED NOT NULL,
    `policy_name` TEXT NOT NULL,
    `provider` TEXT DEFAULT NULL,
    `policy_number` TEXT DEFAULT NULL,
    `premium_amount` TEXT DEFAULT NULL,
    `cash_value` TEXT DEFAULT NULL,
    `coverage_amount` TEXT DEFAULT NULL,
    `start_date` DATE DEFAULT NULL,
    `maturity_date` DATE DEFAULT NULL,
    `payment_frequency` VARCHAR(50) DEFAULT NULL,
    `category` VARCHAR(100) DEFAULT 'Life',
    `notes` TEXT DEFAULT NULL,
    `is_active` TINYINT(1) NOT NULL DEFAULT 1,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_insurance_user` (`user_id`),
    CONSTRAINT `fk_insurance_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- 9. SHARED ITEMS
-- =============================================================================
CREATE TABLE `shared_items` (
    `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `owner_user_id` INT UNSIGNED NOT NULL,
    `recipient_user_id` INT UNSIGNED NOT NULL,
    `recipient_identifier` VARCHAR(255) DEFAULT NULL,
    `source_type` VARCHAR(50) NOT NULL,
    `source_id` INT UNSIGNED DEFAULT NULL,
    `sync_mode` ENUM('auto','approval','snapshot') NOT NULL DEFAULT 'snapshot',
    `encrypted_data` TEXT NOT NULL,
    `is_stale` TINYINT(1) NOT NULL DEFAULT 0,
    `label` VARCHAR(255) DEFAULT NULL,
    `expires_at` TIMESTAMP NULL DEFAULT NULL,
    `shared_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_shared_items_recipient` (`recipient_user_id`),
    KEY `idx_shared_items_owner_source` (`owner_user_id`, `source_type`, `source_id`),
    CONSTRAINT `fk_shared_items_owner` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_shared_items_recipient` FOREIGN KEY (`recipient_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- 10. PASSWORD VAULT
-- =============================================================================
CREATE TABLE `password_vault` (
    `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` INT UNSIGNED NOT NULL,
    `title` TEXT NOT NULL,
    `website_url` TEXT DEFAULT NULL,
    `username_encrypted` TEXT DEFAULT NULL,
    `password_encrypted` TEXT DEFAULT NULL,
    `notes_encrypted` TEXT DEFAULT NULL,
    `category` VARCHAR(100) NOT NULL DEFAULT 'General',
    `is_favourite` TINYINT(1) NOT NULL DEFAULT 0,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_password_vault_user` (`user_id`),
    CONSTRAINT `fk_password_vault_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- 11. LICENSES
-- =============================================================================
CREATE TABLE `licenses` (
    `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` INT UNSIGNED NOT NULL,
    `product_name` TEXT NOT NULL,
    `vendor` TEXT DEFAULT NULL,
    `license_key_encrypted` TEXT DEFAULT NULL,
    `purchase_date` DATE DEFAULT NULL,
    `expiry_date` DATE DEFAULT NULL,
    `seats` INT NOT NULL DEFAULT 1,
    `notes_encrypted` TEXT DEFAULT NULL,
    `category` VARCHAR(100) NOT NULL DEFAULT 'Software',
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_licenses_user` (`user_id`),
    CONSTRAINT `fk_licenses_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- 12. WEBAUTHN CREDENTIALS
-- =============================================================================
CREATE TABLE `user_credentials_webauthn` (
    `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` INT UNSIGNED NOT NULL,
    `credential_id` VARCHAR(512) NOT NULL,
    `public_key` TEXT NOT NULL,
    `transports` VARCHAR(255) DEFAULT NULL,
    `sign_count` INT UNSIGNED NOT NULL DEFAULT 0,
    `backup_eligible` TINYINT(1) NOT NULL DEFAULT 0,
    `backup_state` TINYINT(1) NOT NULL DEFAULT 0,
    `name` VARCHAR(255) DEFAULT NULL,
    `last_used_at` TIMESTAMP NULL DEFAULT NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_webauthn_credential_id` (`credential_id`),
    KEY `idx_webauthn_user` (`user_id`),
    CONSTRAINT `fk_webauthn_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- 13. WEBAUTHN CHALLENGES
-- =============================================================================
CREATE TABLE `webauthn_challenges` (
    `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `challenge` VARCHAR(128) NOT NULL,
    `user_id` INT UNSIGNED DEFAULT NULL,
    `type` ENUM('register','authenticate') NOT NULL,
    `expires_at` TIMESTAMP NOT NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_webauthn_challenge` (`challenge`),
    KEY `idx_webauthn_challenges_user` (`user_id`),
    CONSTRAINT `fk_webauthn_challenges_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- 14. PORTFOLIO SNAPSHOTS
-- =============================================================================
CREATE TABLE `portfolio_snapshots` (
    `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` INT UNSIGNED NOT NULL,
    `snapshot_date` DATE NOT NULL,
    `total_assets` DECIMAL(20,2) NOT NULL DEFAULT 0.00,
    `total_liquid` DECIMAL(20,2) NOT NULL DEFAULT 0.00,
    `total_liabilities` DECIMAL(20,2) NOT NULL DEFAULT 0.00,
    `net_worth` DECIMAL(20,2) NOT NULL DEFAULT 0.00,
    `base_currency` VARCHAR(3) NOT NULL DEFAULT 'GBP',
    `details_json` TEXT DEFAULT NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_portfolio_snapshots` (`user_id`, `snapshot_date`),
    CONSTRAINT `fk_portfolio_snapshots_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- 15. AUDIT LOG
-- =============================================================================
CREATE TABLE `audit_log` (
    `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` INT UNSIGNED DEFAULT NULL,
    `action` VARCHAR(100) NOT NULL,
    `resource_type` VARCHAR(100) DEFAULT NULL,
    `resource_id` INT UNSIGNED DEFAULT NULL,
    `ip_address` VARCHAR(45) DEFAULT NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_audit_log_user` (`user_id`),
    KEY `idx_audit_log_action` (`action`),
    KEY `idx_audit_log_created` (`created_at`),
    CONSTRAINT `fk_audit_log_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- 16. ACCOUNT DETAIL TEMPLATES
-- =============================================================================
CREATE TABLE `account_detail_templates` (
    `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` INT UNSIGNED NOT NULL,
    `account_type_id` INT UNSIGNED NOT NULL,
    `subtype` VARCHAR(50) NOT NULL DEFAULT '',
    `country_id` INT UNSIGNED NOT NULL,
    `is_global` TINYINT(1) NOT NULL DEFAULT 0,
    `field_keys` JSON NOT NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_user_template_combo` (`user_id`, `account_type_id`, `subtype`, `country_id`, `is_global`),
    KEY `idx_template_country` (`country_id`),
    CONSTRAINT `fk_template_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_template_account_type` FOREIGN KEY (`account_type_id`) REFERENCES `account_types` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_template_country` FOREIGN KEY (`country_id`) REFERENCES `countries` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- 17. CURRENCY RATE HISTORY
-- =============================================================================
CREATE TABLE `currency_rate_history` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `currency_id` INT UNSIGNED NOT NULL,
    `rate_to_base` DECIMAL(15,8) NOT NULL,
    `recorded_at` DATE NOT NULL,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_currency_date` (`currency_id`, `recorded_at`),
    CONSTRAINT `fk_rate_history_currency` FOREIGN KEY (`currency_id`) REFERENCES `currencies` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- 18. INVITATIONS
-- =============================================================================
CREATE TABLE `invitations` (
    `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `token` VARCHAR(128) NOT NULL,
    `email` VARCHAR(255) NOT NULL,
    `invited_by` INT UNSIGNED NOT NULL,
    `expires_at` TIMESTAMP NOT NULL,
    `used_at` TIMESTAMP NULL DEFAULT NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_invitations_token` (`token`),
    KEY `idx_invitations_email` (`email`),
    CONSTRAINT `fk_invitations_invited_by` FOREIGN KEY (`invited_by`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- 19. PASSWORD HISTORY
-- =============================================================================
CREATE TABLE `password_history` (
    `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` INT UNSIGNED NOT NULL,
    `password_hash` VARCHAR(255) NOT NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_password_history_user` (`user_id`),
    CONSTRAINT `fk_password_history_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- 20. RATE LIMITS
-- =============================================================================
CREATE TABLE `rate_limits` (
    `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `action` VARCHAR(50) NOT NULL,
    `identifier` VARCHAR(255) NOT NULL,
    `attempts` INT NOT NULL DEFAULT 1,
    `window_start` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_rate_limits_action_id` (`action`, `identifier`),
    KEY `idx_rate_limits_window` (`window_start`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- DEFERRED FOREIGN KEY: countries.default_currency_id -> currencies.id
-- (Both tables must exist before this constraint can be added)
-- =============================================================================
ALTER TABLE `countries`
    ADD CONSTRAINT `fk_countries_default_currency` FOREIGN KEY (`default_currency_id`) REFERENCES `currencies` (`id`) ON DELETE SET NULL;
