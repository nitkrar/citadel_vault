-- Worker dispatcher system settings
INSERT INTO `system_settings` (`setting_key`, `setting_value`) VALUES
    ('worker_enabled', '1'),
    ('worker_threshold', '50')
ON DUPLICATE KEY UPDATE `setting_key` = `setting_key`;
