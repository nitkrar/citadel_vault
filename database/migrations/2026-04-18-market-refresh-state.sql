CREATE TABLE IF NOT EXISTS `market_refresh_state` (
    `state_key`             VARCHAR(50) NOT NULL,
    `last_refresh_attempt`  TIMESTAMP NULL DEFAULT NULL,
    `updated_at`            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`state_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
