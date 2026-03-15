-- =============================================================================
-- Migration: Enforce one snapshot per user per day
-- Date: 2026-03-15
-- Description: Keep only the latest snapshot per user per day, then add a
--              UNIQUE constraint on (user_id, snapshot_date).
--              Snapshot entries cascade-delete automatically.
-- =============================================================================

-- Step 1: Delete older duplicates, keeping only the latest per user per day
DELETE ps FROM portfolio_snapshots ps
INNER JOIN (
    SELECT user_id, snapshot_date, MAX(id) AS keep_id
    FROM portfolio_snapshots
    GROUP BY user_id, snapshot_date
) latest ON ps.user_id = latest.user_id
        AND ps.snapshot_date = latest.snapshot_date
        AND ps.id != latest.keep_id;

-- Step 2: Drop the old non-unique index and add a unique constraint
ALTER TABLE `portfolio_snapshots`
    DROP INDEX `idx_snapshots_user_date`,
    ADD UNIQUE KEY `uk_snapshots_user_date` (`user_id`, `snapshot_date`);
