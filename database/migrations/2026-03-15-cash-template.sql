-- =============================================================================
-- Migration: Add Cash asset template
-- Date: 2026-03-15
-- Description: Separate "Cash" template (physical currency, petty cash)
--              distinct from existing "Cash Equivalent" (money market, T-bills)
-- =============================================================================

INSERT INTO `entry_templates` (`template_key`, `owner_id`, `name`, `icon`, `country_code`, `subtype`, `fields`) VALUES
('asset', NULL, 'Cash', 'wallet', NULL, 'cash', JSON_ARRAY(
    JSON_OBJECT('key', 'title',              'label', 'Description',       'type', 'text',         'required', true),
    JSON_OBJECT('key', 'linked_account_id',  'label', 'Linked Account',   'type', 'account_link', 'required', false),
    JSON_OBJECT('key', 'currency',           'label', 'Currency',          'type', 'text',         'required', false),
    JSON_OBJECT('key', 'value',              'label', 'Amount',            'type', 'number',       'required', false, 'portfolio_role', 'value'),
    JSON_OBJECT('key', 'location',           'label', 'Location / Holder', 'type', 'text',         'required', false),
    JSON_OBJECT('key', 'notes',              'label', 'Notes',             'type', 'textarea',     'required', false)
))
ON DUPLICATE KEY UPDATE `fields` = VALUES(`fields`);
