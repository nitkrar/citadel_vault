-- =============================================================================
-- Portfolio Overhaul Migration — Production
-- Run on existing prod DB (does NOT drop/recreate tables)
-- =============================================================================

-- ─── Schema changes ──────────────────────────────────────────────────────────

-- 1. Add is_liability to entry_templates (skip if already exists)
 ALTER TABLE entry_templates ADD COLUMN is_liability TINYINT(1) NOT NULL DEFAULT 0 AFTER subtype;

-- 2. Add base_currency to currency_rate_history
 ALTER TABLE currency_rate_history ADD COLUMN base_currency VARCHAR(3) NOT NULL DEFAULT 'GBP' AFTER rate_to_base;

-- 3. Expand encrypted_data columns to MEDIUMTEXT
ALTER TABLE vault_entries MODIFY encrypted_data MEDIUMTEXT NOT NULL;
ALTER TABLE portfolio_snapshots MODIFY encrypted_data MEDIUMTEXT NOT NULL;

-- 4. Set credit card as liability
UPDATE entry_templates SET is_liability = 1 WHERE template_key = 'account' AND subtype = 'credit_card';

-- ─── Template field updates (portfolio_role markers) ─────────────────────────
-- These UPDATE the JSON fields column on global templates to add portfolio_role

-- Generic Asset: value field
UPDATE entry_templates SET fields = JSON_ARRAY(
    JSON_OBJECT('key', 'title',              'label', 'Asset Name',      'type', 'text',         'required', true),
    JSON_OBJECT('key', 'linked_account_id',  'label', 'Linked Account',  'type', 'account_link', 'required', false),
    JSON_OBJECT('key', 'currency',           'label', 'Currency',        'type', 'text',         'required', false),
    JSON_OBJECT('key', 'value',              'label', 'Value',           'type', 'number',       'required', false, 'portfolio_role', 'value'),
    JSON_OBJECT('key', 'notes',              'label', 'Notes',           'type', 'textarea',     'required', false)
) WHERE template_key = 'asset' AND subtype IS NULL AND country_code IS NULL AND owner_id IS NULL;

-- Real Estate: current_value field
UPDATE entry_templates SET fields = JSON_ARRAY(
    JSON_OBJECT('key', 'title',          'label', 'Property Name',  'type', 'text',     'required', true),
    JSON_OBJECT('key', 'address',        'label', 'Address',        'type', 'textarea', 'required', false),
    JSON_OBJECT('key', 'purchase_price', 'label', 'Purchase Price', 'type', 'number',   'required', false),
    JSON_OBJECT('key', 'current_value',  'label', 'Current Value',  'type', 'number',   'required', false, 'portfolio_role', 'value'),
    JSON_OBJECT('key', 'currency',       'label', 'Currency',       'type', 'text',     'required', false),
    JSON_OBJECT('key', 'notes',          'label', 'Notes',          'type', 'textarea', 'required', false)
) WHERE template_key = 'asset' AND subtype = 'real_estate' AND owner_id IS NULL;

-- Vehicle: current_value field
UPDATE entry_templates SET fields = JSON_ARRAY(
    JSON_OBJECT('key', 'title',         'label', 'Vehicle',         'type', 'text',     'required', true),
    JSON_OBJECT('key', 'make_model',    'label', 'Make / Model',    'type', 'text',     'required', false),
    JSON_OBJECT('key', 'year',          'label', 'Year',            'type', 'number',   'required', false),
    JSON_OBJECT('key', 'vin',           'label', 'VIN',             'type', 'secret',   'required', false),
    JSON_OBJECT('key', 'current_value', 'label', 'Current Value',   'type', 'number',   'required', false, 'portfolio_role', 'value'),
    JSON_OBJECT('key', 'currency',      'label', 'Currency',        'type', 'text',     'required', false),
    JSON_OBJECT('key', 'notes',         'label', 'Notes',           'type', 'textarea', 'required', false)
) WHERE template_key = 'asset' AND subtype = 'vehicle' AND owner_id IS NULL;

-- Stock: shares (quantity) + price_per_share (price)
UPDATE entry_templates SET fields = JSON_ARRAY(
    JSON_OBJECT('key', 'title',              'label', 'Name',             'type', 'text',         'required', true),
    JSON_OBJECT('key', 'linked_account_id',  'label', 'Linked Account',  'type', 'account_link', 'required', false),
    JSON_OBJECT('key', 'ticker',             'label', 'Ticker Symbol',   'type', 'text',         'required', false),
    JSON_OBJECT('key', 'shares',             'label', 'Shares',          'type', 'number',       'required', false, 'portfolio_role', 'quantity'),
    JSON_OBJECT('key', 'price_per_share',    'label', 'Price per Share', 'type', 'number',       'required', false, 'portfolio_role', 'price'),
    JSON_OBJECT('key', 'currency',           'label', 'Currency',        'type', 'text',         'required', false),
    JSON_OBJECT('key', 'notes',              'label', 'Notes',           'type', 'textarea',     'required', false)
) WHERE template_key = 'asset' AND subtype = 'stock' AND owner_id IS NULL;

-- Bond: face_value field
UPDATE entry_templates SET fields = JSON_ARRAY(
    JSON_OBJECT('key', 'title',              'label', 'Bond Name',       'type', 'text',         'required', true),
    JSON_OBJECT('key', 'linked_account_id',  'label', 'Linked Account',  'type', 'account_link', 'required', false),
    JSON_OBJECT('key', 'issuer',             'label', 'Issuer',          'type', 'text',         'required', false),
    JSON_OBJECT('key', 'face_value',         'label', 'Face Value',      'type', 'number',       'required', false, 'portfolio_role', 'value'),
    JSON_OBJECT('key', 'coupon_rate',        'label', 'Coupon Rate %',   'type', 'number',       'required', false),
    JSON_OBJECT('key', 'maturity_date',      'label', 'Maturity Date',   'type', 'date',         'required', false),
    JSON_OBJECT('key', 'currency',           'label', 'Currency',        'type', 'text',         'required', false),
    JSON_OBJECT('key', 'notes',              'label', 'Notes',           'type', 'textarea',     'required', false)
) WHERE template_key = 'asset' AND subtype = 'bond' AND owner_id IS NULL;

-- Crypto: quantity + NEW price_per_unit field
UPDATE entry_templates SET fields = JSON_ARRAY(
    JSON_OBJECT('key', 'title',              'label', 'Name',              'type', 'text',         'required', true),
    JSON_OBJECT('key', 'linked_account_id',  'label', 'Linked Account',    'type', 'account_link', 'required', false),
    JSON_OBJECT('key', 'coin',               'label', 'Coin / Token',     'type', 'text',         'required', false),
    JSON_OBJECT('key', 'quantity',            'label', 'Quantity',         'type', 'number',       'required', false, 'portfolio_role', 'quantity'),
    JSON_OBJECT('key', 'price_per_unit',     'label', 'Price per Unit',   'type', 'number',       'required', false, 'portfolio_role', 'price'),
    JSON_OBJECT('key', 'wallet_address',     'label', 'Wallet Address',   'type', 'secret',       'required', false),
    JSON_OBJECT('key', 'currency',           'label', 'Currency',         'type', 'text',         'required', false),
    JSON_OBJECT('key', 'notes',              'label', 'Notes',            'type', 'textarea',     'required', false)
) WHERE template_key = 'asset' AND subtype = 'crypto' AND owner_id IS NULL;

-- Cash Equivalent: value field
UPDATE entry_templates SET fields = JSON_ARRAY(
    JSON_OBJECT('key', 'title',              'label', 'Name',            'type', 'text',         'required', true),
    JSON_OBJECT('key', 'linked_account_id',  'label', 'Linked Account',  'type', 'account_link', 'required', false),
    JSON_OBJECT('key', 'currency',           'label', 'Currency',        'type', 'text',         'required', false),
    JSON_OBJECT('key', 'value',              'label', 'Value',           'type', 'number',       'required', false, 'portfolio_role', 'value'),
    JSON_OBJECT('key', 'notes',              'label', 'Notes',           'type', 'textarea',     'required', false)
) WHERE template_key = 'asset' AND subtype = 'cash_equivalent' AND owner_id IS NULL;

-- ─── Remove balance from account templates ───────────────────────────────────
-- DC1: Accounts are containers, not value holders.
-- NOTE: This removes the balance field from template definitions only.
-- Existing encrypted entry data is unaffected (balance values stay in blobs).

-- Generic Bank Account
UPDATE entry_templates SET fields = JSON_ARRAY(
    JSON_OBJECT('key', 'title',          'label', 'Account Name',    'type', 'text',     'required', true),
    JSON_OBJECT('key', 'institution',    'label', 'Institution',     'type', 'text',     'required', false),
    JSON_OBJECT('key', 'account_number', 'label', 'Account Number',  'type', 'secret',   'required', false),
    JSON_OBJECT('key', 'currency',       'label', 'Currency',        'type', 'text',     'required', false),
    JSON_OBJECT('key', 'notes',          'label', 'Notes',           'type', 'textarea', 'required', false)
) WHERE template_key = 'account' AND subtype IS NULL AND country_code IS NULL AND owner_id IS NULL;

-- Savings Account
UPDATE entry_templates SET fields = JSON_ARRAY(
    JSON_OBJECT('key', 'title',          'label', 'Account Name',    'type', 'text',     'required', true),
    JSON_OBJECT('key', 'institution',    'label', 'Institution',     'type', 'text',     'required', false),
    JSON_OBJECT('key', 'account_number', 'label', 'Account Number',  'type', 'secret',   'required', false),
    JSON_OBJECT('key', 'interest_rate',  'label', 'Interest Rate %', 'type', 'number',   'required', false),
    JSON_OBJECT('key', 'currency',       'label', 'Currency',        'type', 'text',     'required', false),
    JSON_OBJECT('key', 'notes',          'label', 'Notes',           'type', 'textarea', 'required', false)
) WHERE template_key = 'account' AND subtype = 'savings' AND owner_id IS NULL;

-- Checking Account
UPDATE entry_templates SET fields = JSON_ARRAY(
    JSON_OBJECT('key', 'title',          'label', 'Account Name',    'type', 'text',     'required', true),
    JSON_OBJECT('key', 'institution',    'label', 'Institution',     'type', 'text',     'required', false),
    JSON_OBJECT('key', 'account_number', 'label', 'Account Number',  'type', 'secret',   'required', false),
    JSON_OBJECT('key', 'routing_number', 'label', 'Routing Number',  'type', 'secret',   'required', false),
    JSON_OBJECT('key', 'currency',       'label', 'Currency',        'type', 'text',     'required', false),
    JSON_OBJECT('key', 'notes',          'label', 'Notes',           'type', 'textarea', 'required', false)
) WHERE template_key = 'account' AND subtype = 'checking' AND owner_id IS NULL;

-- Brokerage Account
UPDATE entry_templates SET fields = JSON_ARRAY(
    JSON_OBJECT('key', 'title',          'label', 'Account Name',    'type', 'text',     'required', true),
    JSON_OBJECT('key', 'institution',    'label', 'Broker',          'type', 'text',     'required', false),
    JSON_OBJECT('key', 'account_number', 'label', 'Account Number',  'type', 'secret',   'required', false),
    JSON_OBJECT('key', 'currency',       'label', 'Currency',        'type', 'text',     'required', false),
    JSON_OBJECT('key', 'notes',          'label', 'Notes',           'type', 'textarea', 'required', false)
) WHERE template_key = 'account' AND subtype = 'brokerage' AND owner_id IS NULL;

-- 401(k) / Retirement
UPDATE entry_templates SET fields = JSON_ARRAY(
    JSON_OBJECT('key', 'title',             'label', 'Account Name',        'type', 'text',     'required', true),
    JSON_OBJECT('key', 'institution',       'label', 'Provider',            'type', 'text',     'required', false),
    JSON_OBJECT('key', 'account_number',    'label', 'Account Number',      'type', 'secret',   'required', false),
    JSON_OBJECT('key', 'employer_match',    'label', 'Employer Match %',    'type', 'number',   'required', false),
    JSON_OBJECT('key', 'currency',          'label', 'Currency',            'type', 'text',     'required', false),
    JSON_OBJECT('key', 'notes',             'label', 'Notes',               'type', 'textarea', 'required', false)
) WHERE template_key = 'account' AND subtype = '401k' AND owner_id IS NULL;

-- Credit Card (balance removed, is_liability already set above)
UPDATE entry_templates SET fields = JSON_ARRAY(
    JSON_OBJECT('key', 'title',          'label', 'Card Name',       'type', 'text',     'required', true),
    JSON_OBJECT('key', 'institution',    'label', 'Issuer',          'type', 'text',     'required', false),
    JSON_OBJECT('key', 'card_number',    'label', 'Card Number',     'type', 'secret',   'required', false),
    JSON_OBJECT('key', 'credit_limit',   'label', 'Credit Limit',    'type', 'number',   'required', false),
    JSON_OBJECT('key', 'currency',       'label', 'Currency',        'type', 'text',     'required', false),
    JSON_OBJECT('key', 'notes',          'label', 'Notes',           'type', 'textarea', 'required', false)
) WHERE template_key = 'account' AND subtype = 'credit_card' AND owner_id IS NULL;

-- Wallet / Prepaid
UPDATE entry_templates SET fields = JSON_ARRAY(
    JSON_OBJECT('key', 'title',          'label', 'Wallet Name',    'type', 'text',     'required', true),
    JSON_OBJECT('key', 'provider',       'label', 'Provider',       'type', 'text',     'required', false),
    JSON_OBJECT('key', 'account_id',     'label', 'Account ID',     'type', 'secret',   'required', false),
    JSON_OBJECT('key', 'currency',       'label', 'Currency',       'type', 'text',     'required', false),
    JSON_OBJECT('key', 'notes',          'label', 'Notes',          'type', 'textarea', 'required', false)
) WHERE template_key = 'account' AND subtype = 'wallet' AND owner_id IS NULL;

-- UK Bank Account
UPDATE entry_templates SET fields = JSON_ARRAY(
    JSON_OBJECT('key', 'title',          'label', 'Account Name',   'type', 'text',     'required', true),
    JSON_OBJECT('key', 'institution',    'label', 'Bank',           'type', 'text',     'required', false),
    JSON_OBJECT('key', 'sort_code',      'label', 'Sort Code',      'type', 'secret',   'required', false),
    JSON_OBJECT('key', 'account_number', 'label', 'Account Number', 'type', 'secret',   'required', false),
    JSON_OBJECT('key', 'notes',          'label', 'Notes',          'type', 'textarea', 'required', false)
) WHERE template_key = 'account' AND country_code = 'GB' AND subtype IS NULL AND owner_id IS NULL;

-- US Bank Account
UPDATE entry_templates SET fields = JSON_ARRAY(
    JSON_OBJECT('key', 'title',          'label', 'Account Name',   'type', 'text',     'required', true),
    JSON_OBJECT('key', 'institution',    'label', 'Bank',           'type', 'text',     'required', false),
    JSON_OBJECT('key', 'routing_number', 'label', 'Routing Number', 'type', 'secret',   'required', false),
    JSON_OBJECT('key', 'account_number', 'label', 'Account Number', 'type', 'secret',   'required', false),
    JSON_OBJECT('key', 'notes',          'label', 'Notes',          'type', 'textarea', 'required', false)
) WHERE template_key = 'account' AND country_code = 'US' AND subtype IS NULL AND owner_id IS NULL;

-- India Bank Account
UPDATE entry_templates SET fields = JSON_ARRAY(
    JSON_OBJECT('key', 'title',          'label', 'Account Name',   'type', 'text',     'required', true),
    JSON_OBJECT('key', 'institution',    'label', 'Bank',           'type', 'text',     'required', false),
    JSON_OBJECT('key', 'ifsc_code',      'label', 'IFSC Code',      'type', 'text',     'required', false),
    JSON_OBJECT('key', 'account_number', 'label', 'Account Number', 'type', 'secret',   'required', false),
    JSON_OBJECT('key', 'notes',          'label', 'Notes',          'type', 'textarea', 'required', false)
) WHERE template_key = 'account' AND country_code = 'IN' AND subtype IS NULL AND owner_id IS NULL;
