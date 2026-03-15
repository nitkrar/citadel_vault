-- =============================================================================
-- Migration: Move registration settings to system_settings
-- Date: 2026-03-15
-- =============================================================================

INSERT INTO `system_settings` (`setting_key`, `setting_value`)
VALUES ('self_registration', 'false'),
       ('require_email_verification', 'true')
ON DUPLICATE KEY UPDATE setting_value = setting_value;
