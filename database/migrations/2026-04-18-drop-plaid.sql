DROP TABLE IF EXISTS plaid_items;
DELETE FROM system_settings WHERE setting_key = 'plaid_enabled';
