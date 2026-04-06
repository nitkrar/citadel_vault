-- Migration: Add share_group_id for grouping share actions
ALTER TABLE shared_items ADD COLUMN share_group_id CHAR(36) DEFAULT NULL AFTER encrypted_data;
CREATE INDEX idx_shared_group ON shared_items(share_group_id);
