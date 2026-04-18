-- Add prefer_after_hours system setting (default off).
-- Gates the after-hours price preference in TickerPrices::parseResponse.
-- Idempotent: safe to run multiple times.
INSERT INTO system_settings (setting_key, setting_value, type, category, description)
VALUES ('prefer_after_hours', 'false', 'gatekeeper', 'prices',
        'Prefer post-market quote over regular close when fetching prices')
ON DUPLICATE KEY UPDATE setting_key = setting_key;
