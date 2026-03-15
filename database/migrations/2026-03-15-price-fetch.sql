-- =============================================================================
-- Stock/Crypto Price Fetch Migration
-- =============================================================================
-- Creates: exchanges, ticker_prices, ticker_price_history tables
-- Modifies: stock + crypto templates to add cost_price field
-- =============================================================================

-- ── Exchanges reference table ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `exchanges` (
    `id`            INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `country_code`  VARCHAR(10) NOT NULL,
    `name`          VARCHAR(50) NOT NULL,
    `suffix`        VARCHAR(10) NOT NULL DEFAULT '',
    `display_order` INT NOT NULL DEFAULT 0,
    PRIMARY KEY (`id`),
    KEY `idx_exchanges_country` (`country_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO `exchanges` (`country_code`, `name`, `suffix`, `display_order`) VALUES
    ('US', 'NYSE',    '',   1),
    ('US', 'NASDAQ',  '',   2),
    ('GB', 'LSE',     'L',  1),
    ('IN', 'NSE',     'NS', 1),
    ('IN', 'BSE',     'BO', 2),
    ('JP', 'TSE',     'T',  1),
    ('HK', 'HKEX',    'HK', 1),
    ('AU', 'ASX',     'AX', 1)
ON DUPLICATE KEY UPDATE `name` = VALUES(`name`);

-- ── Ticker price cache ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `ticker_prices` (
    `ticker`     VARCHAR(20) NOT NULL,
    `exchange`   VARCHAR(50) DEFAULT NULL,
    `price`      DECIMAL(15,8) NOT NULL,
    `currency`   VARCHAR(10) NOT NULL,
    `name`       VARCHAR(255) DEFAULT NULL,
    `fetched_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`ticker`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Ticker price history (permanent daily record) ────────────────────────
CREATE TABLE IF NOT EXISTS `ticker_price_history` (
    `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `ticker`      VARCHAR(20) NOT NULL,
    `exchange`    VARCHAR(50) DEFAULT NULL,
    `price`       DECIMAL(15,8) NOT NULL,
    `currency`    VARCHAR(10) NOT NULL,
    `recorded_at` DATE NOT NULL,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_ticker_date` (`ticker`, `recorded_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Add cost_price field to Stock template (after price_per_share) ───────
UPDATE entry_templates
SET fields = JSON_ARRAY_INSERT(
    fields,
    '$[5]',
    JSON_OBJECT('key', 'cost_price', 'label', 'Cost Price', 'type', 'number', 'required', false)
)
WHERE template_key = 'asset' AND subtype = 'stock' AND owner_id IS NULL
  AND JSON_SEARCH(fields, 'one', 'cost_price') IS NULL;

-- ── Add cost_price field to Crypto template (after price_per_unit) ───────
UPDATE entry_templates
SET fields = JSON_ARRAY_INSERT(
    fields,
    '$[5]',
    JSON_OBJECT('key', 'cost_price', 'label', 'Cost Price', 'type', 'number', 'required', false)
)
WHERE template_key = 'asset' AND subtype = 'crypto' AND owner_id IS NULL
  AND JSON_SEARCH(fields, 'one', 'cost_price') IS NULL;
