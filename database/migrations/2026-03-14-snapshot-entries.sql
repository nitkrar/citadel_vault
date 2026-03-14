-- Migration: Split Snapshot Model — per-entry snapshot rows
-- Date: 2026-03-14
-- Description: Add portfolio_snapshot_entries table for per-entry snapshot data.
--              portfolio_snapshots.encrypted_data now stores only metadata.
--              Per-entry encrypted blobs go in this new table.

CREATE TABLE IF NOT EXISTS `portfolio_snapshot_entries` (
    `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `snapshot_id`     INT UNSIGNED NOT NULL,
    `entry_id`        INT UNSIGNED DEFAULT NULL,
    `encrypted_data`  TEXT NOT NULL,
    PRIMARY KEY (`id`),
    KEY `idx_snapshot_entries` (`snapshot_id`),
    CONSTRAINT `fk_snapshot_entry_snapshot` FOREIGN KEY (`snapshot_id`) REFERENCES `portfolio_snapshots` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_snapshot_entry_vault` FOREIGN KEY (`entry_id`) REFERENCES `vault_entries` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
