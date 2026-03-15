-- Add is_active flag to countries (mirrors currencies pattern)
ALTER TABLE `countries`
  ADD COLUMN `is_active` TINYINT(1) NOT NULL DEFAULT 1 AFTER `display_order`;
