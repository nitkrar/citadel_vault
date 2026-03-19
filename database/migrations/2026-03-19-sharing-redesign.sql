-- =============================================================================
-- Sharing API Redesign Migration
-- =============================================================================
-- 1. Remove duplicate shares (keep oldest per sender+entry+recipient combo)
-- 2. Consolidate per-identifier ghost users to global ghost (id=0)
-- 3. Add UNIQUE constraint for upsert-based duplicate prevention
-- 4. Delete per-identifier ghost user rows
-- =============================================================================

-- Step 1: Remove duplicate shares (keep oldest — lowest ID — per combo)
-- Only applies to rows with non-NULL recipient_id
DELETE s1 FROM shared_items s1
INNER JOIN shared_items s2
ON s1.sender_id = s2.sender_id
  AND s1.source_entry_id = s2.source_entry_id
  AND s1.recipient_id = s2.recipient_id
  AND s1.id > s2.id
WHERE s1.recipient_id IS NOT NULL;

-- Step 2: Point existing ghost shares to the global ghost user (id=0)
UPDATE shared_items si
INNER JOIN users u ON si.recipient_id = u.id
SET si.recipient_id = 0
WHERE u.role = 'ghost' AND u.id != 0;

-- Step 3: Add UNIQUE constraint
-- MySQL treats NULL recipient_id values as distinct (won't conflict)
ALTER TABLE shared_items
ADD UNIQUE KEY `uq_share_sender_entry_recipient` (`sender_id`, `source_entry_id`, `recipient_id`);

-- Step 4: Delete per-identifier ghost users (vault keys cascade-delete via FK)
DELETE FROM users WHERE role = 'ghost' AND id != 0;
