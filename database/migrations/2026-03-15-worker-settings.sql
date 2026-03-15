-- Worker dispatcher system settings
INSERT INTO `system_settings` (`setting_key`, `setting_value`) VALUES
    ('worker_mode', 'count'),
    ('worker_threshold', '50'),
    ('worker_adaptive_ms', '100')
ON DUPLICATE KEY UPDATE `setting_key` = `setting_key`;

-- Clean up old keys if they exist (replaced by worker_mode)
DELETE FROM `system_settings` WHERE `setting_key` = 'worker_enabled';
