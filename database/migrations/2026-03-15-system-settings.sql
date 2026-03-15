-- =============================================================================
-- Migration: System Settings Table
-- Date: 2026-03-15
-- Description: Global KV store for admin-configurable app settings
-- =============================================================================

CREATE TABLE IF NOT EXISTS `system_settings` (
    `setting_key`   VARCHAR(100)  NOT NULL,
    `setting_value` TEXT          NOT NULL,
    `created_by`    INT UNSIGNED      NULL,
    `updated_by`    INT UNSIGNED      NULL,
    `created_at`    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`setting_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed default settings
INSERT INTO `system_settings` (`setting_key`, `setting_value`)
VALUES ('ticker_price_ttl', '86400'),
       ('default_vault_tab', 'account'),
       ('auth_check_interval', '300'),
       ('self_registration', 'false'),
       ('require_email_verification', 'true'),
       ('invite_expiry_days', '7'),
       ('lockout_tier3_duration', '7776000')
ON DUPLICATE KEY UPDATE `setting_value` = `setting_value`;
