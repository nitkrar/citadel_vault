-- Settings Framework: add metadata columns for data-driven admin UI

ALTER TABLE `system_settings`
  ADD COLUMN IF NOT EXISTS `type` VARCHAR(20) NOT NULL DEFAULT 'config' AFTER `setting_value`,
  ADD COLUMN IF NOT EXISTS `category` VARCHAR(50) NOT NULL DEFAULT 'general' AFTER `type`,
  ADD COLUMN IF NOT EXISTS `description` VARCHAR(255) DEFAULT NULL AFTER `category`,
  ADD COLUMN IF NOT EXISTS `options` JSON DEFAULT NULL AFTER `description`;

-- Populate metadata for existing settings

UPDATE `system_settings` SET `type` = 'gatekeeper', `category` = 'registration',
  `description` = 'Allow self-registration', `options` = NULL
WHERE `setting_key` = 'self_registration';

UPDATE `system_settings` SET `type` = 'gatekeeper', `category` = 'registration',
  `description` = 'Require email verification for new users', `options` = NULL
WHERE `setting_key` = 'require_email_verification';

UPDATE `system_settings` SET `type` = 'config', `category` = 'registration',
  `description` = 'Invite link expiry (days)', `options` = '["1","3","7","14","30"]'
WHERE `setting_key` = 'invite_expiry_days';

UPDATE `system_settings` SET `type` = 'config', `category` = 'security',
  `description` = 'Auth re-check interval (seconds)', `options` = '["60","300","900","1800"]'
WHERE `setting_key` = 'auth_check_interval';

UPDATE `system_settings` SET `type` = 'config', `category` = 'security',
  `description` = 'Permanent lockout duration (seconds)', `options` = '["86400","604800","2592000","7776000"]'
WHERE `setting_key` = 'lockout_tier3_duration';

UPDATE `system_settings` SET `type` = 'config', `category` = 'vault',
  `description` = 'Default vault tab for new users', `options` = '["all","account","asset","password","license","insurance","custom"]'
WHERE `setting_key` = 'default_vault_tab';

UPDATE `system_settings` SET `type` = 'config', `category` = 'pricing',
  `description` = 'Price cache duration (seconds)', `options` = '["3600","21600","43200","86400"]'
WHERE `setting_key` = 'ticker_price_ttl';

UPDATE `system_settings` SET `type` = 'gatekeeper', `category` = 'performance',
  `description` = 'Web Worker dispatch mode', `options` = '["disabled","count","adaptive","adaptive_decay"]'
WHERE `setting_key` = 'worker_mode';

UPDATE `system_settings` SET `type` = 'config', `category` = 'performance',
  `description` = 'Worker entry count threshold', `options` = NULL
WHERE `setting_key` = 'worker_threshold';

UPDATE `system_settings` SET `type` = 'config', `category` = 'performance',
  `description` = 'Worker timing threshold (ms)', `options` = NULL
WHERE `setting_key` = 'worker_adaptive_ms';

UPDATE `system_settings` SET `type` = 'gatekeeper', `category` = 'cache',
  `description` = 'Vault cache behavior on lock', `options` = '["instant_unlock","always_fetch"]'
WHERE `setting_key` = 'cache_mode';

UPDATE `system_settings` SET `type` = 'config', `category` = 'cache',
  `description` = 'Cache auto-expiry (hours, 0 = no expiry)', `options` = NULL
WHERE `setting_key` = 'cache_ttl_hours';
