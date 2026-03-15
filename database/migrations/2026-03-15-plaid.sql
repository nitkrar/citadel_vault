-- Plaid Integration: items table + gatekeeper setting

CREATE TABLE IF NOT EXISTS `plaid_items` (
    `id`                INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id`           INT UNSIGNED NOT NULL,
    `item_id`           VARCHAR(100) NOT NULL,
    `access_token`      TEXT NOT NULL,
    `status`            ENUM('active', 'error', 'reauth_required') NOT NULL DEFAULT 'active',
    `created_at`        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_user_item` (`user_id`, `item_id`),
    CONSTRAINT `fk_plaid_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO `system_settings` (`setting_key`, `setting_value`, `type`, `category`, `description`, `options`)
VALUES ('plaid_enabled', 'false', 'gatekeeper', 'integrations', 'Enable Plaid bank connections', NULL)
ON DUPLICATE KEY UPDATE `setting_key` = `setting_key`;
