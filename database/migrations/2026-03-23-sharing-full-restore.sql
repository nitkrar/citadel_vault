-- 2026-03-23: Add sharing feature columns (sync_mode, source_type, label, expires_at)
-- Idempotent: safe to re-run

SET @col1 = (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'shared_items' AND column_name = 'sync_mode');
SET @sql1 = IF(@col1 = 0,
    "ALTER TABLE shared_items ADD COLUMN sync_mode ENUM('snapshot','continuous') NOT NULL DEFAULT 'snapshot' AFTER encrypted_data",
    'SELECT 1');
PREPARE s1 FROM @sql1; EXECUTE s1; DEALLOCATE PREPARE s1;

SET @col2 = (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'shared_items' AND column_name = 'source_type');
SET @sql2 = IF(@col2 = 0,
    "ALTER TABLE shared_items ADD COLUMN source_type VARCHAR(50) NOT NULL DEFAULT 'entry' AFTER entry_type",
    'SELECT 1');
PREPARE s2 FROM @sql2; EXECUTE s2; DEALLOCATE PREPARE s2;

SET @col3 = (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'shared_items' AND column_name = 'label');
SET @sql3 = IF(@col3 = 0,
    "ALTER TABLE shared_items ADD COLUMN label VARCHAR(255) DEFAULT NULL AFTER sync_mode",
    'SELECT 1');
PREPARE s3 FROM @sql3; EXECUTE s3; DEALLOCATE PREPARE s3;

SET @col4 = (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'shared_items' AND column_name = 'expires_at');
SET @sql4 = IF(@col4 = 0,
    "ALTER TABLE shared_items ADD COLUMN expires_at TIMESTAMP NULL DEFAULT NULL AFTER label",
    'SELECT 1');
PREPARE s4 FROM @sql4; EXECUTE s4; DEALLOCATE PREPARE s4;
