-- =============================================================================
-- Citadel Vault — Database Schema (Client-Side Encryption)
-- =============================================================================
-- Target: MariaDB / MySQL 8+ with InnoDB
-- Character Set: utf8mb4, Collation: utf8mb4_unicode_ci
--
-- Usage:
--   mysql -u root citadel_vault_db < 01-schema.sql
--   mysql -u root citadel_vault_db < 02-seed.sql
-- =============================================================================

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
SET time_zone = "+00:00";
SET FOREIGN_KEY_CHECKS = 0;

-- Drop all tables (FK checks disabled for clean re-creation)
DROP TABLE IF EXISTS `currency_rate_history`;
DROP TABLE IF EXISTS `portfolio_snapshots`;
DROP TABLE IF EXISTS `audit_log`;
DROP TABLE IF EXISTS `shared_items`;
DROP TABLE IF EXISTS `vault_entries`;
DROP TABLE IF EXISTS `entry_templates`;
DROP TABLE IF EXISTS `system_settings`;
DROP TABLE IF EXISTS `user_preferences`;
DROP TABLE IF EXISTS `user_vault_keys`;
DROP TABLE IF EXISTS `webauthn_challenges`;
DROP TABLE IF EXISTS `user_credentials_webauthn`;
DROP TABLE IF EXISTS `rate_limits`;
DROP TABLE IF EXISTS `password_history`;
DROP TABLE IF EXISTS `countries`;
DROP TABLE IF EXISTS `currencies`;
DROP TABLE IF EXISTS `users`;

-- =============================================================================
-- 1. USERS
-- =============================================================================
CREATE TABLE `users` (
    `id`                    INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `username`              VARCHAR(50) NOT NULL,
    `display_name`          VARCHAR(255) DEFAULT NULL,
    `email`                 VARCHAR(255) NOT NULL,
    `password_hash`         VARCHAR(255) NOT NULL,
    `role`                  ENUM('user','admin','ghost') NOT NULL DEFAULT 'user',
    `is_active`             TINYINT(1) NOT NULL DEFAULT 1,
    `email_verified`        TINYINT(1) NOT NULL DEFAULT 0,
    `email_verify_token`    VARCHAR(255) DEFAULT NULL,
    `password_reset_token`  VARCHAR(255) DEFAULT NULL,
    `password_reset_expires` DATETIME DEFAULT NULL,
    `must_reset_password`   TINYINT(1) NOT NULL DEFAULT 0,
    `failed_login_attempts` INT NOT NULL DEFAULT 0,
    `locked_until`          TIMESTAMP NULL DEFAULT NULL,
    `last_failed_login_at`  TIMESTAMP NULL DEFAULT NULL,
    `created_at`            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_users_username` (`username`),
    UNIQUE KEY `uk_users_email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- 2. USER VAULT KEYS (1:1 with users)
-- =============================================================================
CREATE TABLE `user_vault_keys` (
    `id`                        INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id`                   INT UNSIGNED NOT NULL,
    `vault_key_salt`            VARCHAR(255) DEFAULT NULL,
    `encrypted_dek`             TEXT DEFAULT NULL,
    `recovery_key_salt`         VARCHAR(255) DEFAULT NULL,
    `encrypted_dek_recovery`    TEXT DEFAULT NULL,
    `recovery_key_encrypted`    TEXT DEFAULT NULL,
    `public_key`                TEXT DEFAULT NULL,
    `encrypted_private_key`     TEXT DEFAULT NULL,
    `must_reset_vault_key`      TINYINT(1) NOT NULL DEFAULT 0,
    `admin_action_message`      VARCHAR(500) DEFAULT NULL,
    `created_at`                TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`                TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_vault_keys_user` (`user_id`),
    CONSTRAINT `fk_vault_keys_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- 3. USER PREFERENCES (KV store)
-- =============================================================================
CREATE TABLE `user_preferences` (
    `id`            INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id`       INT UNSIGNED NOT NULL,
    `setting_key`   VARCHAR(100) NOT NULL,
    `setting_value` TEXT NOT NULL,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_user_pref` (`user_id`, `setting_key`),
    CONSTRAINT `fk_prefs_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- 3b. SYSTEM SETTINGS (global KV store, admin-only write)
-- =============================================================================
CREATE TABLE `system_settings` (
    `setting_key`   VARCHAR(100)  NOT NULL,
    `setting_value` TEXT          NOT NULL,
    `created_by`    INT UNSIGNED      NULL,
    `updated_by`    INT UNSIGNED      NULL,
    `created_at`    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`setting_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- 4. ENTRY TEMPLATES
-- =============================================================================
CREATE TABLE `entry_templates` (
    `id`                        INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `template_key`              VARCHAR(100) NOT NULL,
    `owner_id`                  INT UNSIGNED NULL,
    `name`                      VARCHAR(255) NOT NULL,
    `icon`                      VARCHAR(50) DEFAULT NULL,
    `country_code`              VARCHAR(10) DEFAULT NULL,
    `subtype`                   VARCHAR(100) DEFAULT NULL,
    `is_liability`              TINYINT(1) NOT NULL DEFAULT 0,
    `schema_version`            INT NOT NULL DEFAULT 1,
    `fields`                    JSON NOT NULL,
    `is_active`                 TINYINT(1) NOT NULL DEFAULT 1,
    `promotion_requested`       TINYINT(1) NOT NULL DEFAULT 0,
    `promotion_requested_at`    TIMESTAMP NULL DEFAULT NULL,
    `created_at`                TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`                TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_template_combo` (`template_key`, `owner_id`, `country_code`, `subtype`),
    KEY `idx_templates_owner` (`owner_id`),
    CONSTRAINT `fk_templates_owner` FOREIGN KEY (`owner_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- 5. VAULT ENTRIES (replaces password_vault, accounts, assets, licenses, insurance_policies)
-- =============================================================================
CREATE TABLE `vault_entries` (
    `id`                INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id`           INT UNSIGNED NOT NULL,
    `entry_type`        VARCHAR(50) NOT NULL,
    `template_id`       INT UNSIGNED NULL,
    `schema_version`    INT NOT NULL DEFAULT 1,
    `encrypted_data`    MEDIUMTEXT NOT NULL,
    `deleted_at`        TIMESTAMP NULL DEFAULT NULL,
    `created_at`        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_entries_user_type` (`user_id`, `entry_type`, `deleted_at`),
    CONSTRAINT `fk_entries_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_entries_template` FOREIGN KEY (`template_id`) REFERENCES `entry_templates` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- 6. SHARED ITEMS
-- =============================================================================
CREATE TABLE `shared_items` (
    `id`                        INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `sender_id`                 INT UNSIGNED NOT NULL,
    `recipient_identifier`      VARCHAR(255) NOT NULL,
    `recipient_id`              INT UNSIGNED NULL,
    `source_entry_id`           INT UNSIGNED NOT NULL,
    `entry_type`                VARCHAR(50) NOT NULL,
    `template_id`               INT UNSIGNED NULL,
    `encrypted_data`            TEXT NOT NULL,
    `is_ghost`                  TINYINT(1) NOT NULL DEFAULT 0,
    `created_at`                TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`                TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_shared_sender_entry` (`sender_id`, `source_entry_id`),
    KEY `idx_shared_recipient` (`recipient_id`),
    KEY `idx_shared_identifier` (`recipient_identifier`),
    CONSTRAINT `fk_shared_sender` FOREIGN KEY (`sender_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_shared_recipient` FOREIGN KEY (`recipient_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
    CONSTRAINT `fk_shared_entry` FOREIGN KEY (`source_entry_id`) REFERENCES `vault_entries` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_shared_template` FOREIGN KEY (`template_id`) REFERENCES `entry_templates` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- 7. PORTFOLIO SNAPSHOTS
-- =============================================================================
CREATE TABLE `portfolio_snapshots` (
    `id`                INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id`           INT UNSIGNED NOT NULL,
    `snapshot_date`     DATE NOT NULL,
    `snapshot_time`     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `encrypted_data`    MEDIUMTEXT NOT NULL,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_snapshots_user_date` (`user_id`, `snapshot_date`),
    CONSTRAINT `fk_snapshots_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- 8. AUDIT LOG
-- =============================================================================
CREATE TABLE `audit_log` (
    `id`                INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id`           INT UNSIGNED NULL,
    `action`            VARCHAR(100) NOT NULL,
    `resource_type`     VARCHAR(100) DEFAULT NULL,
    `resource_id`       INT UNSIGNED DEFAULT NULL,
    `ip_hash`           VARCHAR(64) DEFAULT NULL,
    `created_at`        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_audit_user` (`user_id`),
    KEY `idx_audit_action` (`action`),
    KEY `idx_audit_created` (`created_at`),
    CONSTRAINT `fk_audit_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- 9. CURRENCIES
-- =============================================================================
CREATE TABLE `currencies` (
    `id`                    INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `name`                  VARCHAR(100) NOT NULL,
    `code`                  VARCHAR(10) NOT NULL,
    `symbol`                VARCHAR(10) NOT NULL,
    `display_order`         INT NOT NULL DEFAULT 999,
    `is_active`             TINYINT(1) NOT NULL DEFAULT 1,
    `exchange_rate_to_base` DECIMAL(15,8) NOT NULL DEFAULT 1.00000000,
    `last_updated`          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_currencies_code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- 10. COUNTRIES
-- =============================================================================
CREATE TABLE `countries` (
    `id`                    INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `name`                  VARCHAR(100) NOT NULL,
    `code`                  VARCHAR(10) NOT NULL,
    `flag_emoji`            VARCHAR(10) DEFAULT NULL,
    `display_order`         INT NOT NULL DEFAULT 999,
    `is_active`             TINYINT(1) NOT NULL DEFAULT 1,
    `default_currency_id`   INT UNSIGNED DEFAULT NULL,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_countries_code` (`code`),
    KEY `idx_countries_currency` (`default_currency_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- 11. CURRENCY RATE HISTORY
-- =============================================================================
CREATE TABLE `currency_rate_history` (
    `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `currency_id`   INT UNSIGNED NOT NULL,
    `rate_to_base`  DECIMAL(15,8) NOT NULL,
    `base_currency` VARCHAR(3) NOT NULL DEFAULT 'GBP',
    `recorded_at`   DATE NOT NULL,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_currency_date` (`currency_id`, `recorded_at`),
    CONSTRAINT `fk_rate_history_currency` FOREIGN KEY (`currency_id`) REFERENCES `currencies` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- SUPPORTING TABLES (carried forward)
-- =============================================================================

-- WebAuthn credentials
CREATE TABLE `user_credentials_webauthn` (
    `id`                INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id`           INT UNSIGNED NOT NULL,
    `credential_id`     VARCHAR(512) NOT NULL,
    `public_key`        TEXT NOT NULL,
    `transports`        VARCHAR(255) DEFAULT NULL,
    `sign_count`        INT UNSIGNED NOT NULL DEFAULT 0,
    `backup_eligible`   TINYINT(1) NOT NULL DEFAULT 0,
    `backup_state`      TINYINT(1) NOT NULL DEFAULT 0,
    `name`              VARCHAR(255) DEFAULT NULL,
    `last_used_at`      TIMESTAMP NULL DEFAULT NULL,
    `created_at`        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_webauthn_credential_id` (`credential_id`),
    KEY `idx_webauthn_user` (`user_id`),
    CONSTRAINT `fk_webauthn_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- WebAuthn challenges
CREATE TABLE `webauthn_challenges` (
    `id`            INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `challenge`     VARCHAR(128) NOT NULL,
    `user_id`       INT UNSIGNED DEFAULT NULL,
    `type`          ENUM('register','authenticate') NOT NULL,
    `expires_at`    TIMESTAMP NOT NULL,
    `created_at`    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_webauthn_challenge` (`challenge`),
    KEY `idx_webauthn_challenges_user` (`user_id`),
    CONSTRAINT `fk_webauthn_challenges_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Password history
CREATE TABLE `password_history` (
    `id`            INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id`       INT UNSIGNED NOT NULL,
    `password_hash` VARCHAR(255) NOT NULL,
    `created_at`    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_password_history_user` (`user_id`),
    CONSTRAINT `fk_password_history_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Rate limits
CREATE TABLE `rate_limits` (
    `id`            INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `action`        VARCHAR(50) NOT NULL,
    `identifier`    VARCHAR(255) NOT NULL,
    `attempts`      INT NOT NULL DEFAULT 1,
    `window_start`  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_rate_limits_action_id` (`action`, `identifier`),
    KEY `idx_rate_limits_window` (`window_start`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- DEFERRED FOREIGN KEY: countries.default_currency_id -> currencies.id
-- =============================================================================
ALTER TABLE `countries`
    ADD CONSTRAINT `fk_countries_default_currency` FOREIGN KEY (`default_currency_id`) REFERENCES `currencies` (`id`) ON DELETE SET NULL;

SET FOREIGN_KEY_CHECKS = 1;
