-- =============================================================================
-- Migration: Add auth_check_interval system setting
-- Date: 2026-03-15
-- =============================================================================

INSERT INTO `system_settings` (`setting_key`, `setting_value`)
VALUES ('auth_check_interval', '300')
ON DUPLICATE KEY UPDATE setting_value = setting_value;
