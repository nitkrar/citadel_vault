-- Add email_verify_expires column for token expiry (24-hour TTL)
-- Run BEFORE code push (backward compatible — column is nullable)

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS `email_verify_expires` DATETIME DEFAULT NULL
    AFTER `email_verify_token`;
