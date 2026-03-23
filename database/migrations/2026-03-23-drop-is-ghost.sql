-- Drop redundant is_ghost column from shared_items
-- Status is now derived from recipient_id (0 or NULL = pending, else active)
-- Idempotent: safe to re-run

-- Check if column exists before dropping (MariaDB syntax)
SET @col_exists = (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'shared_items' AND column_name = 'is_ghost');

SET @sql = IF(@col_exists > 0, 'ALTER TABLE shared_items DROP COLUMN is_ghost', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
