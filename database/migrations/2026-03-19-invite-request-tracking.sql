-- =============================================================================
-- Invite Request Tracking + Admin Toggle
-- =============================================================================
-- 1. Add system setting to enable/disable invite request form
-- 2. Create table to track invite requests (prevent duplicate emails, audit trail)
-- =============================================================================

-- System setting: invite_requests_enabled (default: false — disabled)
INSERT INTO system_settings (setting_key, setting_value, type, category, description, options)
VALUES ('invite_requests_enabled', 'false', 'gatekeeper', 'registration',
        'Allow unauthenticated users to request an invite via the registration page',
        NULL)
ON DUPLICATE KEY UPDATE setting_key = setting_key;

-- Table to track all invite requests (regardless of success)
CREATE TABLE IF NOT EXISTS `invite_requests` (
    `id`            INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `email`         VARCHAR(255) NOT NULL,
    `name`          VARCHAR(255) DEFAULT NULL,
    `ip_hash`       VARCHAR(128) DEFAULT NULL,
    `status`        ENUM('pending', 'approved', 'rejected', 'ignored') NOT NULL DEFAULT 'pending',
    `created_at`    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_invite_request_email` (`email`),
    KEY `idx_invite_request_ip` (`ip_hash`),
    KEY `idx_invite_request_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
