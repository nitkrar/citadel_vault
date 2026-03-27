-- Allow NULL source_entry_id for portfolio shares (no backing vault entry).
-- FK constraint stays — MySQL skips FK check on NULL values.
-- Run BEFORE code push.
ALTER TABLE shared_items MODIFY source_entry_id INT UNSIGNED NULL;
