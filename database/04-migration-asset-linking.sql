-- =============================================================================
-- Migration: Asset-Account Linking + Cash Equivalent Template
-- =============================================================================
-- Adds `linked_account_id` (account_link) field to asset templates:
--   Generic Asset, Stock, Bond, Crypto
-- Inserts new Cash Equivalent template.
--
-- Tested on: MariaDB 10.5.29 (HelioHost prod), MariaDB 12.2.2 (local dev)
-- Run AFTER 01-schema.sql + 02-seed.sql on existing databases.
--
-- NOTE: These statements fully replace the `fields` JSON column. They are
-- idempotent — running again just overwrites with the same values.
-- =============================================================================

-- ── 1. Generic Asset — add linked_account_id after title ────────────────────
UPDATE entry_templates SET fields = JSON_ARRAY(
    JSON_OBJECT('key', 'title',              'label', 'Asset Name',      'type', 'text',         'required', true),
    JSON_OBJECT('key', 'linked_account_id',  'label', 'Linked Account',  'type', 'account_link', 'required', false),
    JSON_OBJECT('key', 'currency',           'label', 'Currency',        'type', 'text',         'required', false),
    JSON_OBJECT('key', 'value',              'label', 'Value',           'type', 'number',       'required', false),
    JSON_OBJECT('key', 'notes',              'label', 'Notes',           'type', 'textarea',     'required', false)
) WHERE template_key = 'asset' AND subtype IS NULL AND country_code IS NULL AND owner_id IS NULL;

-- ── 2. Stock / Equity — add linked_account_id after title ───────────────────
UPDATE entry_templates SET fields = JSON_ARRAY(
    JSON_OBJECT('key', 'title',              'label', 'Name',             'type', 'text',         'required', true),
    JSON_OBJECT('key', 'linked_account_id',  'label', 'Linked Account',  'type', 'account_link', 'required', false),
    JSON_OBJECT('key', 'ticker',             'label', 'Ticker Symbol',   'type', 'text',         'required', false),
    JSON_OBJECT('key', 'shares',             'label', 'Shares',          'type', 'number',       'required', false),
    JSON_OBJECT('key', 'price_per_share',    'label', 'Price per Share', 'type', 'number',       'required', false),
    JSON_OBJECT('key', 'currency',           'label', 'Currency',        'type', 'text',         'required', false),
    JSON_OBJECT('key', 'notes',              'label', 'Notes',           'type', 'textarea',     'required', false)
) WHERE template_key = 'asset' AND subtype = 'stock' AND owner_id IS NULL;

-- ── 3. Bond — add linked_account_id after title ─────────────────────────────
UPDATE entry_templates SET fields = JSON_ARRAY(
    JSON_OBJECT('key', 'title',              'label', 'Bond Name',       'type', 'text',         'required', true),
    JSON_OBJECT('key', 'linked_account_id',  'label', 'Linked Account',  'type', 'account_link', 'required', false),
    JSON_OBJECT('key', 'issuer',             'label', 'Issuer',          'type', 'text',         'required', false),
    JSON_OBJECT('key', 'face_value',         'label', 'Face Value',      'type', 'number',       'required', false),
    JSON_OBJECT('key', 'coupon_rate',        'label', 'Coupon Rate %',   'type', 'number',       'required', false),
    JSON_OBJECT('key', 'maturity_date',      'label', 'Maturity Date',   'type', 'date',         'required', false),
    JSON_OBJECT('key', 'currency',           'label', 'Currency',        'type', 'text',         'required', false),
    JSON_OBJECT('key', 'notes',              'label', 'Notes',           'type', 'textarea',     'required', false)
) WHERE template_key = 'asset' AND subtype = 'bond' AND owner_id IS NULL;

-- ── 4. Cryptocurrency — add linked_account_id after title ───────────────────
UPDATE entry_templates SET fields = JSON_ARRAY(
    JSON_OBJECT('key', 'title',              'label', 'Name',            'type', 'text',         'required', true),
    JSON_OBJECT('key', 'linked_account_id',  'label', 'Linked Account',  'type', 'account_link', 'required', false),
    JSON_OBJECT('key', 'coin',               'label', 'Coin / Token',   'type', 'text',         'required', false),
    JSON_OBJECT('key', 'quantity',            'label', 'Quantity',       'type', 'number',       'required', false),
    JSON_OBJECT('key', 'wallet_address',     'label', 'Wallet Address', 'type', 'secret',       'required', false),
    JSON_OBJECT('key', 'currency',           'label', 'Currency',       'type', 'text',         'required', false),
    JSON_OBJECT('key', 'notes',              'label', 'Notes',          'type', 'textarea',     'required', false)
) WHERE template_key = 'asset' AND subtype = 'crypto' AND owner_id IS NULL;

-- ── 5. Cash Equivalent — new template ───────────────────────────────────────
-- Will fail with duplicate key if already inserted; safe to ignore the error.
INSERT INTO entry_templates (template_key, owner_id, name, icon, country_code, subtype, fields) VALUES
('asset', NULL, 'Cash Equivalent', 'banknote', NULL, 'cash_equivalent', JSON_ARRAY(
    JSON_OBJECT('key', 'title',              'label', 'Name',            'type', 'text',         'required', true),
    JSON_OBJECT('key', 'linked_account_id',  'label', 'Linked Account',  'type', 'account_link', 'required', false),
    JSON_OBJECT('key', 'currency',           'label', 'Currency',        'type', 'text',         'required', false),
    JSON_OBJECT('key', 'value',              'label', 'Value',           'type', 'number',       'required', false),
    JSON_OBJECT('key', 'notes',              'label', 'Notes',           'type', 'textarea',     'required', false)
));
