-- =============================================================================
-- Citadel Vault — Seed Data (Client-Side Encryption)
-- =============================================================================
-- System users, entry templates, currencies, and countries.
-- Run after 01-schema.sql.
-- =============================================================================

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";

-- =============================================================================
-- SYSTEM USERS
-- =============================================================================

-- Ghost user (id=0): sentinel for ghost shares (private key discarded)
INSERT INTO `users` (`id`, `username`, `email`, `password_hash`, `role`, `is_active`)
VALUES (0, '__ghost__', 'ghost@system.internal', '', 'ghost', 0);

-- Admin user: create via scripts/setup_admin.php instead of hardcoded hash.
-- Usage: php scripts/setup_admin.php <username> <email> <password>

-- =============================================================================
-- ENTRY TEMPLATES — Global (owner_id = NULL)
-- =============================================================================

-- ── Passwords ───────────────────────────────────────────────────────────
INSERT INTO `entry_templates` (`template_key`, `owner_id`, `name`, `icon`, `country_code`, `subtype`, `fields`) VALUES
('password', NULL, 'Password', 'key', NULL, NULL, JSON_ARRAY(
    JSON_OBJECT('key', 'title',    'label', 'Title',    'type', 'text',     'required', true),
    JSON_OBJECT('key', 'url',      'label', 'Website',  'type', 'url',      'required', false),
    JSON_OBJECT('key', 'username', 'label', 'Username', 'type', 'text',     'required', false),
    JSON_OBJECT('key', 'password', 'label', 'Password', 'type', 'secret',   'required', true),
    JSON_OBJECT('key', 'notes',    'label', 'Notes',    'type', 'textarea', 'required', false)
));

-- ── Accounts — Generic ──────────────────────────────────────────────────
INSERT INTO `entry_templates` (`template_key`, `owner_id`, `name`, `icon`, `country_code`, `subtype`, `fields`) VALUES
('account', NULL, 'Bank Account', 'bank', NULL, NULL, JSON_ARRAY(
    JSON_OBJECT('key', 'title',          'label', 'Account Name',    'type', 'text',     'required', true),
    JSON_OBJECT('key', 'institution',    'label', 'Institution',     'type', 'text',     'required', false),
    JSON_OBJECT('key', 'account_number', 'label', 'Account Number',  'type', 'secret',   'required', false),
    JSON_OBJECT('key', 'currency',       'label', 'Currency',        'type', 'text',     'required', false),
    JSON_OBJECT('key', 'notes',          'label', 'Notes',           'type', 'textarea', 'required', false)
));

-- Account subtypes
INSERT INTO `entry_templates` (`template_key`, `owner_id`, `name`, `icon`, `country_code`, `subtype`, `fields`) VALUES
('account', NULL, 'Savings Account', 'piggy-bank', NULL, 'savings', JSON_ARRAY(
    JSON_OBJECT('key', 'title',          'label', 'Account Name',    'type', 'text',     'required', true),
    JSON_OBJECT('key', 'institution',    'label', 'Institution',     'type', 'text',     'required', false),
    JSON_OBJECT('key', 'account_number', 'label', 'Account Number',  'type', 'secret',   'required', false),
    JSON_OBJECT('key', 'interest_rate',  'label', 'Interest Rate %', 'type', 'number',   'required', false),
    JSON_OBJECT('key', 'currency',       'label', 'Currency',        'type', 'text',     'required', false),
    JSON_OBJECT('key', 'notes',          'label', 'Notes',           'type', 'textarea', 'required', false)
)),
('account', NULL, 'Checking Account', 'bank', NULL, 'checking', JSON_ARRAY(
    JSON_OBJECT('key', 'title',          'label', 'Account Name',    'type', 'text',     'required', true),
    JSON_OBJECT('key', 'institution',    'label', 'Institution',     'type', 'text',     'required', false),
    JSON_OBJECT('key', 'account_number', 'label', 'Account Number',  'type', 'secret',   'required', false),
    JSON_OBJECT('key', 'routing_number', 'label', 'Routing Number',  'type', 'secret',   'required', false),
    JSON_OBJECT('key', 'currency',       'label', 'Currency',        'type', 'text',     'required', false),
    JSON_OBJECT('key', 'notes',          'label', 'Notes',           'type', 'textarea', 'required', false)
)),
('account', NULL, 'Brokerage Account', 'trending-up', NULL, 'brokerage', JSON_ARRAY(
    JSON_OBJECT('key', 'title',          'label', 'Account Name',    'type', 'text',     'required', true),
    JSON_OBJECT('key', 'institution',    'label', 'Broker',          'type', 'text',     'required', false),
    JSON_OBJECT('key', 'account_number', 'label', 'Account Number',  'type', 'secret',   'required', false),
    JSON_OBJECT('key', 'currency',       'label', 'Currency',        'type', 'text',     'required', false),
    JSON_OBJECT('key', 'notes',          'label', 'Notes',           'type', 'textarea', 'required', false)
)),
('account', NULL, '401(k) / Retirement', 'lock', NULL, '401k', JSON_ARRAY(
    JSON_OBJECT('key', 'title',             'label', 'Account Name',        'type', 'text',     'required', true),
    JSON_OBJECT('key', 'institution',       'label', 'Provider',            'type', 'text',     'required', false),
    JSON_OBJECT('key', 'account_number',    'label', 'Account Number',      'type', 'secret',   'required', false),
    JSON_OBJECT('key', 'employer_match',    'label', 'Employer Match %',    'type', 'number',   'required', false),
    JSON_OBJECT('key', 'currency',          'label', 'Currency',            'type', 'text',     'required', false),
    JSON_OBJECT('key', 'notes',             'label', 'Notes',               'type', 'textarea', 'required', false)
));

-- Credit Card (is_liability = 1)
INSERT INTO `entry_templates` (`template_key`, `owner_id`, `name`, `icon`, `country_code`, `subtype`, `is_liability`, `fields`) VALUES
('account', NULL, 'Credit Card', 'credit-card', NULL, 'credit_card', 1, JSON_ARRAY(
    JSON_OBJECT('key', 'title',          'label', 'Card Name',       'type', 'text',     'required', true),
    JSON_OBJECT('key', 'institution',    'label', 'Issuer',          'type', 'text',     'required', false),
    JSON_OBJECT('key', 'card_number',    'label', 'Card Number',     'type', 'secret',   'required', false),
    JSON_OBJECT('key', 'credit_limit',   'label', 'Credit Limit',    'type', 'number',   'required', false),
    JSON_OBJECT('key', 'currency',       'label', 'Currency',        'type', 'text',     'required', false),
    JSON_OBJECT('key', 'notes',          'label', 'Notes',           'type', 'textarea', 'required', false)
));

INSERT INTO `entry_templates` (`template_key`, `owner_id`, `name`, `icon`, `country_code`, `subtype`, `fields`) VALUES
('account', NULL, 'Wallet / Prepaid', 'wallet', NULL, 'wallet', JSON_ARRAY(
    JSON_OBJECT('key', 'title',          'label', 'Wallet Name',    'type', 'text',     'required', true),
    JSON_OBJECT('key', 'provider',       'label', 'Provider',       'type', 'text',     'required', false),
    JSON_OBJECT('key', 'account_id',     'label', 'Account ID',     'type', 'secret',   'required', false),
    JSON_OBJECT('key', 'currency',       'label', 'Currency',       'type', 'text',     'required', false),
    JSON_OBJECT('key', 'notes',          'label', 'Notes',          'type', 'textarea', 'required', false)
));

-- Account country variants (UK, US, India)
INSERT INTO `entry_templates` (`template_key`, `owner_id`, `name`, `icon`, `country_code`, `subtype`, `fields`) VALUES
('account', NULL, 'UK Bank Account', 'bank', 'GB', NULL, JSON_ARRAY(
    JSON_OBJECT('key', 'title',          'label', 'Account Name',   'type', 'text',     'required', true),
    JSON_OBJECT('key', 'institution',    'label', 'Bank',           'type', 'text',     'required', false),
    JSON_OBJECT('key', 'sort_code',      'label', 'Sort Code',      'type', 'secret',   'required', false),
    JSON_OBJECT('key', 'account_number', 'label', 'Account Number', 'type', 'secret',   'required', false),
    JSON_OBJECT('key', 'notes',          'label', 'Notes',          'type', 'textarea', 'required', false)
)),
('account', NULL, 'US Bank Account', 'bank', 'US', NULL, JSON_ARRAY(
    JSON_OBJECT('key', 'title',          'label', 'Account Name',   'type', 'text',     'required', true),
    JSON_OBJECT('key', 'institution',    'label', 'Bank',           'type', 'text',     'required', false),
    JSON_OBJECT('key', 'routing_number', 'label', 'Routing Number', 'type', 'secret',   'required', false),
    JSON_OBJECT('key', 'account_number', 'label', 'Account Number', 'type', 'secret',   'required', false),
    JSON_OBJECT('key', 'notes',          'label', 'Notes',          'type', 'textarea', 'required', false)
)),
('account', NULL, 'India Bank Account', 'bank', 'IN', NULL, JSON_ARRAY(
    JSON_OBJECT('key', 'title',          'label', 'Account Name',   'type', 'text',     'required', true),
    JSON_OBJECT('key', 'institution',    'label', 'Bank',           'type', 'text',     'required', false),
    JSON_OBJECT('key', 'ifsc_code',      'label', 'IFSC Code',      'type', 'text',     'required', false),
    JSON_OBJECT('key', 'account_number', 'label', 'Account Number', 'type', 'secret',   'required', false),
    JSON_OBJECT('key', 'notes',          'label', 'Notes',          'type', 'textarea', 'required', false)
));

-- ── Assets ──────────────────────────────────────────────────────────────
INSERT INTO `entry_templates` (`template_key`, `owner_id`, `name`, `icon`, `country_code`, `subtype`, `fields`) VALUES
('asset', NULL, 'Asset', 'circle', NULL, NULL, JSON_ARRAY(
    JSON_OBJECT('key', 'title',              'label', 'Asset Name',      'type', 'text',         'required', true),
    JSON_OBJECT('key', 'linked_account_id',  'label', 'Linked Account',  'type', 'account_link', 'required', false),
    JSON_OBJECT('key', 'currency',           'label', 'Currency',        'type', 'text',         'required', false),
    JSON_OBJECT('key', 'value',              'label', 'Value',           'type', 'number',       'required', false, 'portfolio_role', 'value'),
    JSON_OBJECT('key', 'notes',              'label', 'Notes',           'type', 'textarea',     'required', false)
)),
('asset', NULL, 'Real Estate', 'home', NULL, 'real_estate', JSON_ARRAY(
    JSON_OBJECT('key', 'title',          'label', 'Property Name',  'type', 'text',     'required', true),
    JSON_OBJECT('key', 'address',        'label', 'Address',        'type', 'textarea', 'required', false),
    JSON_OBJECT('key', 'purchase_price', 'label', 'Purchase Price', 'type', 'number',   'required', false),
    JSON_OBJECT('key', 'current_value',  'label', 'Current Value',  'type', 'number',   'required', false, 'portfolio_role', 'value'),
    JSON_OBJECT('key', 'currency',       'label', 'Currency',       'type', 'text',     'required', false),
    JSON_OBJECT('key', 'notes',          'label', 'Notes',          'type', 'textarea', 'required', false)
)),
('asset', NULL, 'Vehicle', 'car', NULL, 'vehicle', JSON_ARRAY(
    JSON_OBJECT('key', 'title',         'label', 'Vehicle',         'type', 'text',     'required', true),
    JSON_OBJECT('key', 'make_model',    'label', 'Make / Model',    'type', 'text',     'required', false),
    JSON_OBJECT('key', 'year',          'label', 'Year',            'type', 'number',   'required', false),
    JSON_OBJECT('key', 'vin',           'label', 'VIN',             'type', 'secret',   'required', false),
    JSON_OBJECT('key', 'current_value', 'label', 'Current Value',   'type', 'number',   'required', false, 'portfolio_role', 'value'),
    JSON_OBJECT('key', 'currency',      'label', 'Currency',        'type', 'text',     'required', false),
    JSON_OBJECT('key', 'notes',         'label', 'Notes',           'type', 'textarea', 'required', false)
)),
('asset', NULL, 'Stock / Equity', 'trending-up', NULL, 'stock', JSON_ARRAY(
    JSON_OBJECT('key', 'title',              'label', 'Name',             'type', 'text',         'required', true),
    JSON_OBJECT('key', 'linked_account_id',  'label', 'Linked Account',  'type', 'account_link', 'required', false),
    JSON_OBJECT('key', 'ticker',             'label', 'Ticker Symbol',   'type', 'text',         'required', false),
    JSON_OBJECT('key', 'shares',             'label', 'Shares',          'type', 'number',       'required', false, 'portfolio_role', 'quantity'),
    JSON_OBJECT('key', 'price_per_share',    'label', 'Price per Share', 'type', 'number',       'required', false, 'portfolio_role', 'price'),
    JSON_OBJECT('key', 'cost_price',         'label', 'Cost Price',      'type', 'number',       'required', false),
    JSON_OBJECT('key', 'currency',           'label', 'Currency',        'type', 'text',         'required', false),
    JSON_OBJECT('key', 'notes',              'label', 'Notes',           'type', 'textarea',     'required', false)
)),
('asset', NULL, 'Bond', 'file-text', NULL, 'bond', JSON_ARRAY(
    JSON_OBJECT('key', 'title',              'label', 'Bond Name',       'type', 'text',         'required', true),
    JSON_OBJECT('key', 'linked_account_id',  'label', 'Linked Account',  'type', 'account_link', 'required', false),
    JSON_OBJECT('key', 'issuer',             'label', 'Issuer',          'type', 'text',         'required', false),
    JSON_OBJECT('key', 'face_value',         'label', 'Face Value',      'type', 'number',       'required', false, 'portfolio_role', 'value'),
    JSON_OBJECT('key', 'coupon_rate',        'label', 'Coupon Rate %',   'type', 'number',       'required', false),
    JSON_OBJECT('key', 'maturity_date',      'label', 'Maturity Date',   'type', 'date',         'required', false),
    JSON_OBJECT('key', 'currency',           'label', 'Currency',        'type', 'text',         'required', false),
    JSON_OBJECT('key', 'notes',              'label', 'Notes',           'type', 'textarea',     'required', false)
)),
('asset', NULL, 'Cryptocurrency', 'bitcoin', NULL, 'crypto', JSON_ARRAY(
    JSON_OBJECT('key', 'title',              'label', 'Name',              'type', 'text',         'required', true),
    JSON_OBJECT('key', 'linked_account_id',  'label', 'Linked Account',    'type', 'account_link', 'required', false),
    JSON_OBJECT('key', 'coin',               'label', 'Coin / Token',     'type', 'text',         'required', false),
    JSON_OBJECT('key', 'quantity',            'label', 'Quantity',         'type', 'number',       'required', false, 'portfolio_role', 'quantity'),
    JSON_OBJECT('key', 'price_per_unit',     'label', 'Price per Unit',   'type', 'number',       'required', false, 'portfolio_role', 'price'),
    JSON_OBJECT('key', 'cost_price',         'label', 'Cost Price',       'type', 'number',       'required', false),
    JSON_OBJECT('key', 'wallet_address',     'label', 'Wallet Address',   'type', 'secret',       'required', false),
    JSON_OBJECT('key', 'currency',           'label', 'Currency',         'type', 'text',         'required', false),
    JSON_OBJECT('key', 'notes',              'label', 'Notes',            'type', 'textarea',     'required', false)
)),
('asset', NULL, 'Cash', 'wallet', NULL, 'cash', JSON_ARRAY(
    JSON_OBJECT('key', 'title',              'label', 'Description',       'type', 'text',         'required', true),
    JSON_OBJECT('key', 'linked_account_id',  'label', 'Linked Account',   'type', 'account_link', 'required', false),
    JSON_OBJECT('key', 'currency',           'label', 'Currency',          'type', 'text',         'required', false),
    JSON_OBJECT('key', 'value',              'label', 'Amount',            'type', 'number',       'required', false, 'portfolio_role', 'value'),
    JSON_OBJECT('key', 'location',           'label', 'Location / Holder', 'type', 'text',         'required', false),
    JSON_OBJECT('key', 'notes',              'label', 'Notes',             'type', 'textarea',     'required', false)
)),
('asset', NULL, 'Cash Equivalent', 'banknote', NULL, 'cash_equivalent', JSON_ARRAY(
    JSON_OBJECT('key', 'title',              'label', 'Name',            'type', 'text',         'required', true),
    JSON_OBJECT('key', 'linked_account_id',  'label', 'Linked Account',  'type', 'account_link', 'required', false),
    JSON_OBJECT('key', 'currency',           'label', 'Currency',        'type', 'text',         'required', false),
    JSON_OBJECT('key', 'value',              'label', 'Value',           'type', 'number',       'required', false, 'portfolio_role', 'value'),
    JSON_OBJECT('key', 'notes',              'label', 'Notes',           'type', 'textarea',     'required', false)
));

-- ── Licenses ────────────────────────────────────────────────────────────
INSERT INTO `entry_templates` (`template_key`, `owner_id`, `name`, `icon`, `country_code`, `subtype`, `fields`) VALUES
('license', NULL, 'Software License', 'file-text', NULL, NULL, JSON_ARRAY(
    JSON_OBJECT('key', 'title',         'label', 'Product Name',  'type', 'text',     'required', true),
    JSON_OBJECT('key', 'vendor',        'label', 'Vendor',        'type', 'text',     'required', false),
    JSON_OBJECT('key', 'license_key',   'label', 'License Key',   'type', 'secret',   'required', false),
    JSON_OBJECT('key', 'purchase_date', 'label', 'Purchase Date', 'type', 'date',     'required', false),
    JSON_OBJECT('key', 'expiry_date',   'label', 'Expiry Date',   'type', 'date',     'required', false),
    JSON_OBJECT('key', 'seats',         'label', 'Seats',         'type', 'number',   'required', false),
    JSON_OBJECT('key', 'notes',         'label', 'Notes',         'type', 'textarea', 'required', false)
));

-- ── Insurance ───────────────────────────────────────────────────────────
INSERT INTO `entry_templates` (`template_key`, `owner_id`, `name`, `icon`, `country_code`, `subtype`, `fields`) VALUES
('insurance', NULL, 'Insurance Policy', 'shield', NULL, NULL, JSON_ARRAY(
    JSON_OBJECT('key', 'title',             'label', 'Policy Name',       'type', 'text',     'required', true),
    JSON_OBJECT('key', 'provider',          'label', 'Provider',          'type', 'text',     'required', false),
    JSON_OBJECT('key', 'policy_number',     'label', 'Policy Number',     'type', 'secret',   'required', false),
    JSON_OBJECT('key', 'premium_amount',    'label', 'Premium Amount',    'type', 'number',   'required', false),
    JSON_OBJECT('key', 'coverage_amount',   'label', 'Coverage Amount',   'type', 'number',   'required', false),
    JSON_OBJECT('key', 'start_date',        'label', 'Start Date',        'type', 'date',     'required', false),
    JSON_OBJECT('key', 'maturity_date',     'label', 'Maturity Date',     'type', 'date',     'required', false),
    JSON_OBJECT('key', 'payment_frequency', 'label', 'Payment Frequency', 'type', 'text',     'required', false),
    JSON_OBJECT('key', 'notes',             'label', 'Notes',             'type', 'textarea', 'required', false)
)),
('insurance', NULL, 'Life Insurance', 'heart', NULL, 'life', JSON_ARRAY(
    JSON_OBJECT('key', 'title',             'label', 'Policy Name',       'type', 'text',     'required', true),
    JSON_OBJECT('key', 'provider',          'label', 'Provider',          'type', 'text',     'required', false),
    JSON_OBJECT('key', 'policy_number',     'label', 'Policy Number',     'type', 'secret',   'required', false),
    JSON_OBJECT('key', 'premium_amount',    'label', 'Premium Amount',    'type', 'number',   'required', false),
    JSON_OBJECT('key', 'coverage_amount',   'label', 'Sum Assured',       'type', 'number',   'required', false),
    JSON_OBJECT('key', 'cash_value',        'label', 'Cash Value',        'type', 'number',   'required', false),
    JSON_OBJECT('key', 'beneficiary',       'label', 'Beneficiary',       'type', 'text',     'required', false),
    JSON_OBJECT('key', 'start_date',        'label', 'Start Date',        'type', 'date',     'required', false),
    JSON_OBJECT('key', 'maturity_date',     'label', 'Maturity Date',     'type', 'date',     'required', false),
    JSON_OBJECT('key', 'notes',             'label', 'Notes',             'type', 'textarea', 'required', false)
)),
('insurance', NULL, 'Auto Insurance', 'car', NULL, 'auto', JSON_ARRAY(
    JSON_OBJECT('key', 'title',             'label', 'Policy Name',       'type', 'text',     'required', true),
    JSON_OBJECT('key', 'provider',          'label', 'Provider',          'type', 'text',     'required', false),
    JSON_OBJECT('key', 'policy_number',     'label', 'Policy Number',     'type', 'secret',   'required', false),
    JSON_OBJECT('key', 'vehicle',           'label', 'Vehicle',           'type', 'text',     'required', false),
    JSON_OBJECT('key', 'premium_amount',    'label', 'Premium Amount',    'type', 'number',   'required', false),
    JSON_OBJECT('key', 'coverage_amount',   'label', 'Coverage Amount',   'type', 'number',   'required', false),
    JSON_OBJECT('key', 'start_date',        'label', 'Start Date',        'type', 'date',     'required', false),
    JSON_OBJECT('key', 'expiry_date',       'label', 'Expiry Date',       'type', 'date',     'required', false),
    JSON_OBJECT('key', 'notes',             'label', 'Notes',             'type', 'textarea', 'required', false)
)),
('insurance', NULL, 'Health Insurance', 'activity', NULL, 'health', JSON_ARRAY(
    JSON_OBJECT('key', 'title',             'label', 'Plan Name',         'type', 'text',     'required', true),
    JSON_OBJECT('key', 'provider',          'label', 'Provider',          'type', 'text',     'required', false),
    JSON_OBJECT('key', 'policy_number',     'label', 'Policy Number',     'type', 'secret',   'required', false),
    JSON_OBJECT('key', 'member_id',         'label', 'Member ID',         'type', 'secret',   'required', false),
    JSON_OBJECT('key', 'premium_amount',    'label', 'Premium Amount',    'type', 'number',   'required', false),
    JSON_OBJECT('key', 'deductible',        'label', 'Deductible',        'type', 'number',   'required', false),
    JSON_OBJECT('key', 'start_date',        'label', 'Start Date',        'type', 'date',     'required', false),
    JSON_OBJECT('key', 'expiry_date',       'label', 'Expiry Date',       'type', 'date',     'required', false),
    JSON_OBJECT('key', 'notes',             'label', 'Notes',             'type', 'textarea', 'required', false)
)),
('insurance', NULL, 'Home Insurance', 'home', NULL, 'home', JSON_ARRAY(
    JSON_OBJECT('key', 'title',             'label', 'Policy Name',       'type', 'text',     'required', true),
    JSON_OBJECT('key', 'provider',          'label', 'Provider',          'type', 'text',     'required', false),
    JSON_OBJECT('key', 'policy_number',     'label', 'Policy Number',     'type', 'secret',   'required', false),
    JSON_OBJECT('key', 'property_address',  'label', 'Property Address',  'type', 'textarea', 'required', false),
    JSON_OBJECT('key', 'premium_amount',    'label', 'Premium Amount',    'type', 'number',   'required', false),
    JSON_OBJECT('key', 'coverage_amount',   'label', 'Coverage Amount',   'type', 'number',   'required', false),
    JSON_OBJECT('key', 'start_date',        'label', 'Start Date',        'type', 'date',     'required', false),
    JSON_OBJECT('key', 'expiry_date',       'label', 'Expiry Date',       'type', 'date',     'required', false),
    JSON_OBJECT('key', 'notes',             'label', 'Notes',             'type', 'textarea', 'required', false)
));

-- =============================================================================
-- CURRENCIES — 23 active (with rates) + 116 inactive (rates fetched on demand)
-- Base currency: GBP (rate = 1.0)
-- =============================================================================
INSERT INTO `currencies` (`name`, `code`, `symbol`, `display_order`, `is_active`, `exchange_rate_to_base`) VALUES
-- Active currencies (GBP/INR/USD pinned to top)
('British Pound',        'GBP', '£',     1, 1, 1.00000000),
('US Dollar',            'USD', '$',     3, 1, 0.79000000),
('Indian Rupee',         'INR', '₹',     2, 1, 0.00950000),
('Euro',                 'EUR', '€',   999, 1, 0.85000000),
('Australian Dollar',    'AUD', 'A$',  999, 1, 0.51000000),
('Canadian Dollar',      'CAD', 'C$',  999, 1, 0.58000000),
('Singapore Dollar',     'SGD', 'S$',  999, 1, 0.59000000),
('UAE Dirham',           'AED', 'د.إ', 999, 1, 0.22000000),
('Nigerian Naira',       'NGN', '₦',   999, 1, 0.00051000),
('South African Rand',   'ZAR', 'R',   999, 1, 0.04300000),
('Swiss Franc',          'CHF', 'Fr',  999, 1, 0.89000000),
('Japanese Yen',         'JPY', '¥',   999, 1, 0.00520000),
('Chinese Yuan',         'CNY', '¥',   999, 1, 0.11000000),
('Hong Kong Dollar',     'HKD', 'HK$', 999, 1, 0.10100000),
('Kenyan Shilling',      'KES', 'KSh', 999, 1, 0.00610000),
('Ghanaian Cedi',        'GHS', 'GH₵', 999, 1, 0.05900000),
('New Zealand Dollar',   'NZD', 'NZ$', 999, 1, 0.46000000),
('Brazilian Real',       'BRL', 'R$',  999, 1, 0.16000000),
('Mexican Peso',         'MXN', 'Mex$',999, 1, 0.04000000),
('Swedish Krona',        'SEK', 'kr',  999, 1, 0.07400000),
('Norwegian Krone',      'NOK', 'kr',  999, 1, 0.07300000),
('Turkish Lira',         'TRY', '₺',   999, 1, 0.02300000),
('Egyptian Pound',       'EGP', 'E£',  999, 1, 0.01600000),
-- Inactive currencies (rates populated on first "Refresh Rates")
('Afghan Afghani',                       'AFN',  '؋',    999, 0, 0.00000000),
('Albanian Lek',                         'ALL',  'Lek',  999, 0, 0.00000000),
('Armenian Dram',                        'AMD',  'Դ',    999, 0, 0.00000000),
('Netherlands Antillian Guilder',        'ANG',  'ƒ',    999, 0, 0.00000000),
('Angolan Kwanza',                       'AOA',  'Kz',   999, 0, 0.00000000),
('Argentine Peso',                       'ARS',  '$',    999, 0, 0.00000000),
('Aruban Florin',                        'AWG',  'ƒ',    999, 0, 0.00000000),
('Azerbaijani Manat',                    'AZN',  '₼',    999, 0, 0.00000000),
('Bosnia-Herzegovina Convertible Mark',  'BAM',  'KM',   999, 0, 0.00000000),
('Barbados Dollar',                      'BBD',  '$',    999, 0, 0.00000000),
('Bangladeshi Taka',                     'BDT',  '৳',    999, 0, 0.00000000),
('Bulgarian Lev',                        'BGN',  'лв',   999, 0, 0.00000000),
('Bahraini Dinar',                       'BHD',  'د.ب',  999, 0, 0.00000000),
('Burundian Franc',                      'BIF',  '₣',    999, 0, 0.00000000),
('Bermudian Dollar',                     'BMD',  '$',    999, 0, 0.00000000),
('Brunei Dollar',                        'BND',  '$',    999, 0, 0.00000000),
('Bolivian Boliviano',                   'BOB',  '$b',   999, 0, 0.00000000),
('Bahamian Dollar',                      'BSD',  '$',    999, 0, 0.00000000),
('Botswana Pula',                        'BWP',  'P',    999, 0, 0.00000000),
('Belarusian Ruble',                     'BYN',  'Br',   999, 0, 0.00000000),
('Belize Dollar',                        'BZD',  'BZ$',  999, 0, 0.00000000),
('Congolese Franc',                      'CDF',  '₣',    999, 0, 0.00000000),
('Chilean Peso',                         'CLP',  '$',    999, 0, 0.00000000),
('Colombian Peso',                       'COP',  '$',    999, 0, 0.00000000),
('Costa Rican Colon',                    'CRC',  '₡',    999, 0, 0.00000000),
('Cuban Peso',                           'CUP',  '₱',    999, 0, 0.00000000),
('Cape Verdean Escudo',                  'CVE',  '$',    999, 0, 0.00000000),
('Czech Koruna',                         'CZK',  'Kč',   999, 0, 0.00000000),
('Djiboutian Franc',                     'DJF',  '₣',    999, 0, 0.00000000),
('Algerian Dinar',                       'DZD',  'د.ج',  999, 0, 0.00000000),
('Danish Krone',                         'DKK',  'kr',   999, 0, 0.00000000),
('Dominican Peso',                       'DOP',  'RD$',  999, 0, 0.00000000),
('Eritrean Nakfa',                       'ERN',  'Nfk',  999, 0, 0.00000000),
('Ethiopian Birr',                       'ETB',  'Br',   999, 0, 0.00000000),
('Fiji Dollar',                          'FJD',  '$',    999, 0, 0.00000000),
('Falkland Islands Pound',               'FKP',  '£',    999, 0, 0.00000000),
('Georgian Lari',                        'GEL',  'ლ',    999, 0, 0.00000000),
('Guernsey Pound',                       'GGP',  '£',    999, 0, 0.00000000),
('Gibraltar Pound',                      'GIP',  '£',    999, 0, 0.00000000),
('Gambian Dalasi',                       'GMD',  'D',    999, 0, 0.00000000),
('Guinean Franc',                        'GNF',  '₣',    999, 0, 0.00000000),
('Guatemalan Quetzal',                   'GTQ',  'Q',    999, 0, 0.00000000),
('Guyanese Dollar',                      'GYD',  '$',    999, 0, 0.00000000),
('Honduran Lempira',                     'HNL',  'L',    999, 0, 0.00000000),
('Haitian Gourde',                       'HTG',  'G',    999, 0, 0.00000000),
('Hungarian Forint',                     'HUF',  'Ft',   999, 0, 0.00000000),
('Indonesian Rupiah',                    'IDR',  'Rp',   999, 0, 0.00000000),
('Israeli New Shekel',                   'ILS',  '₪',    999, 0, 0.00000000),
('Manx Pound',                           'IMP',  '£',    999, 0, 0.00000000),
('Iraqi Dinar',                          'IQD',  'ع.د',  999, 0, 0.00000000),
('Iranian Rial',                         'IRR',  '﷼',    999, 0, 0.00000000),
('Icelandic Krona',                      'ISK',  'kr',   999, 0, 0.00000000),
('Jersey Pound',                         'JEP',  '£',    999, 0, 0.00000000),
('Jamaican Dollar',                      'JMD',  'J$',   999, 0, 0.00000000),
('Jordanian Dinar',                      'JOD',  'د.ا',  999, 0, 0.00000000),
('Kyrgyzstani Som',                      'KGS',  'лв',   999, 0, 0.00000000),
('Cambodian Riel',                       'KHR',  '៛',    999, 0, 0.00000000),
('Comorian Franc',                       'KMF',  'FC',   999, 0, 0.00000000),
('South Korean Won',                     'KRW',  '₩',    999, 0, 0.00000000),
('Kuwaiti Dinar',                        'KWD',  'د.ك',  999, 0, 0.00000000),
('Cayman Islands Dollar',                'KYD',  '$',    999, 0, 0.00000000),
('Kazakhstani Tenge',                    'KZT',  'лв',   999, 0, 0.00000000),
('Lao Kip',                              'LAK',  '₭',    999, 0, 0.00000000),
('Lebanese Pound',                       'LBP',  '£',    999, 0, 0.00000000),
('Sri Lankan Rupee',                     'LKR',  '₨',    999, 0, 0.00000000),
('Liberian Dollar',                      'LRD',  '$',    999, 0, 0.00000000),
('Lesotho Loti',                         'LSL',  'L',    999, 0, 0.00000000),
('Libyan Dinar',                         'LYD',  'ل.د',  999, 0, 0.00000000),
('Moroccan Dirham',                      'MAD',  'د.م.', 999, 0, 0.00000000),
('Moldovan Leu',                         'MDL',  'L',    999, 0, 0.00000000),
('Malagasy Ariary',                      'MGA',  'Ar',   999, 0, 0.00000000),
('Macedonian Denar',                     'MKD',  'ден',  999, 0, 0.00000000),
('Burmese Kyat',                         'MMK',  'K',    999, 0, 0.00000000),
('Mongolian Togrog',                     'MNT',  '₮',    999, 0, 0.00000000),
('Mauritanian Ouguiya',                  'MRU',  'UM',   999, 0, 0.00000000),
('Mauritian Rupee',                      'MUR',  '₨',    999, 0, 0.00000000),
('Malawian Kwacha',                      'MWK',  'MK',   999, 0, 0.00000000),
('Malaysian Ringgit',                    'MYR',  'RM',   999, 0, 0.00000000),
('Mozambican Metical',                   'MZN',  'MT',   999, 0, 0.00000000),
('Namibian Dollar',                      'NAD',  '$',    999, 0, 0.00000000),
('Nepalese Rupee',                       'NPR',  '₨',    999, 0, 0.00000000),
('Omani Rial',                           'OMR',  '﷼',    999, 0, 0.00000000),
('Panamanian Balboa',                    'PAB',  'B/.',  999, 0, 0.00000000),
('Peruvian Sol',                         'PEN',  'S/.',  999, 0, 0.00000000),
('Philippine Peso',                      'PHP',  '₱',    999, 0, 0.00000000),
('Pakistani Rupee',                      'PKR',  '₨',    999, 0, 0.00000000),
('Polish Zloty',                         'PLN',  'zł',   999, 0, 0.00000000),
('Paraguayan Guarani',                   'PYG',  'Gs',   999, 0, 0.00000000),
('Qatari Riyal',                         'QAR',  '﷼',    999, 0, 0.00000000),
('Romanian Leu',                         'RON',  'lei',  999, 0, 0.00000000),
('Serbian Dinar',                        'RSD',  'Дін.', 999, 0, 0.00000000),
('Russian Ruble',                        'RUB',  '₽',    999, 0, 0.00000000),
('Rwandan Franc',                        'RWF',  '₣',    999, 0, 0.00000000),
('Saudi Riyal',                          'SAR',  '﷼',    999, 0, 0.00000000),
('Solomon Islands Dollar',               'SBD',  '$',    999, 0, 0.00000000),
('Seychellois Rupee',                    'SCR',  '₨',    999, 0, 0.00000000),
('Saint Helena Pound',                   'SHP',  '£',    999, 0, 0.00000000),
('Somali Shilling',                      'SOS',  'S',    999, 0, 0.00000000),
('Surinamese Dollar',                    'SRD',  '$',    999, 0, 0.00000000),
('Sao Tome and Principe Dobra',          'STN',  'Db',   999, 0, 0.00000000),
('Syrian Pound',                         'SYP',  '£',    999, 0, 0.00000000),
('Thai Baht',                            'THB',  '฿',    999, 0, 0.00000000),
('Trinidad and Tobago Dollar',           'TTD',  'TT$',  999, 0, 0.00000000),
('New Taiwan Dollar',                    'TWD',  'NT$',  999, 0, 0.00000000),
('Tanzanian Shilling',                   'TZS',  'Sh',   999, 0, 0.00000000),
('Ukrainian Hryvnia',                    'UAH',  '₴',    999, 0, 0.00000000),
('Ugandan Shilling',                     'UGX',  'Sh',   999, 0, 0.00000000),
('Uruguayan Peso',                       'UYU',  '$U',   999, 0, 0.00000000),
('Uzbekistani Som',                      'UZS',  'лв',   999, 0, 0.00000000),
('Vietnamese Dong',                      'VND',  '₫',    999, 0, 0.00000000),
('Central African CFA Franc',            'XAF',  'FCFA', 999, 0, 0.00000000),
('East Caribbean Dollar',                'XCD',  '$',    999, 0, 0.00000000),
('West African CFA Franc',               'XOF',  'CFA',  999, 0, 0.00000000),
('CFP Franc',                            'XPF',  '₣',    999, 0, 0.00000000),
('Yemeni Rial',                          'YER',  '﷼',    999, 0, 0.00000000),
('Zambian Kwacha',                       'ZMW',  'ZK',   999, 0, 0.00000000),
('Zimbabwean Dollar',                    'ZWL',  '$',    999, 0, 0.00000000);

-- =============================================================================
-- COUNTRIES (143 — synced with all currencies)
-- Pinned: GB(1), IN(2), US(3); rest default display_order=999
-- =============================================================================
INSERT INTO `countries` (`name`, `code`, `flag_emoji`, `display_order`) VALUES
-- Pinned countries
('United Kingdom',       'GB', '🇬🇧',   1),
('India',                'IN', '🇮🇳',   2),
('United States',        'US', '🇺🇸',   3),
-- All other countries (alphabetical)
('Afghanistan',              'AF', '🇦🇫', 999),
('Albania',                  'AL', '🇦🇱', 999),
('Algeria',                  'DZ', '🇩🇿', 999),
('Angola',                   'AO', '🇦🇴', 999),
('Argentina',                'AR', '🇦🇷', 999),
('Armenia',                  'AM', '🇦🇲', 999),
('Aruba',                    'AW', '🇦🇼', 999),
('Australia',                'AU', '🇦🇺', 999),
('Azerbaijan',               'AZ', '🇦🇿', 999),
('Bahamas',                  'BS', '🇧🇸', 999),
('Bahrain',                  'BH', '🇧🇭', 999),
('Bangladesh',               'BD', '🇧🇩', 999),
('Barbados',                 'BB', '🇧🇧', 999),
('Belarus',                  'BY', '🇧🇾', 999),
('Belize',                   'BZ', '🇧🇿', 999),
('Bermuda',                  'BM', '🇧🇲', 999),
('Bolivia',                  'BO', '🇧🇴', 999),
('Bosnia and Herzegovina',   'BA', '🇧🇦', 999),
('Botswana',                 'BW', '🇧🇼', 999),
('Brazil',                   'BR', '🇧🇷', 999),
('Brunei',                   'BN', '🇧🇳', 999),
('Bulgaria',                 'BG', '🇧🇬', 999),
('Burundi',                  'BI', '🇧🇮', 999),
('Cambodia',                 'KH', '🇰🇭', 999),
('Cameroon',                 'CM', '🇨🇲', 999),
('Canada',                   'CA', '🇨🇦', 999),
('Cape Verde',               'CV', '🇨🇻', 999),
('Cayman Islands',           'KY', '🇰🇾', 999),
('Chile',                    'CL', '🇨🇱', 999),
('China',                    'CN', '🇨🇳', 999),
('Colombia',                 'CO', '🇨🇴', 999),
('Comoros',                  'KM', '🇰🇲', 999),
('Congo (DRC)',              'CD', '🇨🇩', 999),
('Costa Rica',               'CR', '🇨🇷', 999),
('Cuba',                     'CU', '🇨🇺', 999),
('Curaçao',                  'CW', '🇨🇼', 999),
('Czech Republic',           'CZ', '🇨🇿', 999),
('Denmark',                  'DK', '🇩🇰', 999),
('Djibouti',                 'DJ', '🇩🇯', 999),
('Dominica',                 'DM', '🇩🇲', 999),
('Dominican Republic',       'DO', '🇩🇴', 999),
('Egypt',                    'EG', '🇪🇬', 999),
('Eritrea',                  'ER', '🇪🇷', 999),
('Ethiopia',                 'ET', '🇪🇹', 999),
('European Union',           'EU', '🇪🇺', 999),
('Falkland Islands',         'FK', '🇫🇰', 999),
('Fiji',                     'FJ', '🇫🇯', 999),
('France',                   'FR', '🇫🇷', 999),
('French Polynesia',         'PF', '🇵🇫', 999),
('Gambia',                   'GM', '🇬🇲', 999),
('Georgia',                  'GE', '🇬🇪', 999),
('Germany',                  'DE', '🇩🇪', 999),
('Ghana',                    'GH', '🇬🇭', 999),
('Gibraltar',                'GI', '🇬🇮', 999),
('Guatemala',                'GT', '🇬🇹', 999),
('Guernsey',                 'GG', '🇬🇬', 999),
('Guinea',                   'GN', '🇬🇳', 999),
('Guyana',                   'GY', '🇬🇾', 999),
('Haiti',                    'HT', '🇭🇹', 999),
('Honduras',                 'HN', '🇭🇳', 999),
('Hong Kong',                'HK', '🇭🇰', 999),
('Hungary',                  'HU', '🇭🇺', 999),
('Iceland',                  'IS', '🇮🇸', 999),
('Indonesia',                'ID', '🇮🇩', 999),
('Iran',                     'IR', '🇮🇷', 999),
('Iraq',                     'IQ', '🇮🇶', 999),
('Isle of Man',              'IM', '🇮🇲', 999),
('Israel',                   'IL', '🇮🇱', 999),
('Jamaica',                  'JM', '🇯🇲', 999),
('Japan',                    'JP', '🇯🇵', 999),
('Jersey',                   'JE', '🇯🇪', 999),
('Jordan',                   'JO', '🇯🇴', 999),
('Kazakhstan',               'KZ', '🇰🇿', 999),
('Kenya',                    'KE', '🇰🇪', 999),
('Kuwait',                   'KW', '🇰🇼', 999),
('Kyrgyzstan',               'KG', '🇰🇬', 999),
('Laos',                     'LA', '🇱🇦', 999),
('Lebanon',                  'LB', '🇱🇧', 999),
('Lesotho',                  'LS', '🇱🇸', 999),
('Liberia',                  'LR', '🇱🇷', 999),
('Libya',                    'LY', '🇱🇾', 999),
('Madagascar',               'MG', '🇲🇬', 999),
('Malawi',                   'MW', '🇲🇼', 999),
('Malaysia',                 'MY', '🇲🇾', 999),
('Mauritania',               'MR', '🇲🇷', 999),
('Mauritius',                'MU', '🇲🇺', 999),
('Mexico',                   'MX', '🇲🇽', 999),
('Moldova',                  'MD', '🇲🇩', 999),
('Mongolia',                 'MN', '🇲🇳', 999),
('Morocco',                  'MA', '🇲🇦', 999),
('Mozambique',               'MZ', '🇲🇿', 999),
('Myanmar',                  'MM', '🇲🇲', 999),
('Namibia',                  'NA', '🇳🇦', 999),
('Nepal',                    'NP', '🇳🇵', 999),
('New Zealand',              'NZ', '🇳🇿', 999),
('Nigeria',                  'NG', '🇳🇬', 999),
('North Korea',              'KP', '🇰🇵', 999),
('North Macedonia',          'MK', '🇲🇰', 999),
('Norway',                   'NO', '🇳🇴', 999),
('Oman',                     'OM', '🇴🇲', 999),
('Pakistan',                 'PK', '🇵🇰', 999),
('Panama',                   'PA', '🇵🇦', 999),
('Paraguay',                 'PY', '🇵🇾', 999),
('Peru',                     'PE', '🇵🇪', 999),
('Philippines',              'PH', '🇵🇭', 999),
('Poland',                   'PL', '🇵🇱', 999),
('Qatar',                    'QA', '🇶🇦', 999),
('Romania',                  'RO', '🇷🇴', 999),
('Russia',                   'RU', '🇷🇺', 999),
('Rwanda',                   'RW', '🇷🇼', 999),
('Saint Helena',             'SH', '🇸🇭', 999),
('Sao Tome and Principe',    'ST', '🇸🇹', 999),
('Saudi Arabia',             'SA', '🇸🇦', 999),
('Senegal',                  'SN', '🇸🇳', 999),
('Serbia',                   'RS', '🇷🇸', 999),
('Seychelles',               'SC', '🇸🇨', 999),
('Singapore',                'SG', '🇸🇬', 999),
('Solomon Islands',          'SB', '🇸🇧', 999),
('Somalia',                  'SO', '🇸🇴', 999),
('South Africa',             'ZA', '🇿🇦', 999),
('South Korea',              'KR', '🇰🇷', 999),
('Sri Lanka',                'LK', '🇱🇰', 999),
('Suriname',                 'SR', '🇸🇷', 999),
('Sweden',                   'SE', '🇸🇪', 999),
('Switzerland',              'CH', '🇨🇭', 999),
('Syria',                    'SY', '🇸🇾', 999),
('Taiwan',                   'TW', '🇹🇼', 999),
('Tanzania',                 'TZ', '🇹🇿', 999),
('Thailand',                 'TH', '🇹🇭', 999),
('Trinidad and Tobago',      'TT', '🇹🇹', 999),
('Turkey',                   'TR', '🇹🇷', 999),
('Uganda',                   'UG', '🇺🇬', 999),
('Ukraine',                  'UA', '🇺🇦', 999),
('United Arab Emirates',     'AE', '🇦🇪', 999),
('Uruguay',                  'UY', '🇺🇾', 999),
('Uzbekistan',               'UZ', '🇺🇿', 999),
('Vietnam',                  'VN', '🇻🇳', 999),
('Yemen',                    'YE', '🇾🇪', 999),
('Zambia',                   'ZM', '🇿🇲', 999),
('Zimbabwe',                 'ZW', '🇿🇼', 999);

-- =============================================================================
-- EXCHANGES — Stock exchange reference data
-- =============================================================================

INSERT INTO `exchanges` (`country_code`, `name`, `suffix`, `display_order`) VALUES
    ('US', 'NYSE',    '',   1),
    ('US', 'NASDAQ',  '',   2),
    ('GB', 'LSE',     'L',  1),
    ('IN', 'NSE',     'NS', 1),
    ('IN', 'BSE',     'BO', 2),
    ('JP', 'TSE',     'T',  1),
    ('HK', 'HKEX',    'HK', 1),
    ('AU', 'ASX',     'AX', 1);

-- =============================================================================
-- LINK COUNTRIES TO DEFAULT CURRENCIES
-- =============================================================================
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'GBP') WHERE `code` = 'GB';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'INR') WHERE `code` = 'IN';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'USD') WHERE `code` = 'US';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'AFN') WHERE `code` = 'AF';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'ALL') WHERE `code` = 'AL';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'DZD') WHERE `code` = 'DZ';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'AOA') WHERE `code` = 'AO';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'ARS') WHERE `code` = 'AR';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'AMD') WHERE `code` = 'AM';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'AWG') WHERE `code` = 'AW';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'AUD') WHERE `code` = 'AU';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'AZN') WHERE `code` = 'AZ';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'BSD') WHERE `code` = 'BS';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'BHD') WHERE `code` = 'BH';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'BDT') WHERE `code` = 'BD';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'BBD') WHERE `code` = 'BB';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'BYN') WHERE `code` = 'BY';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'BZD') WHERE `code` = 'BZ';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'BMD') WHERE `code` = 'BM';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'BOB') WHERE `code` = 'BO';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'BAM') WHERE `code` = 'BA';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'BWP') WHERE `code` = 'BW';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'BRL') WHERE `code` = 'BR';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'BND') WHERE `code` = 'BN';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'BGN') WHERE `code` = 'BG';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'BIF') WHERE `code` = 'BI';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'KHR') WHERE `code` = 'KH';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'XAF') WHERE `code` = 'CM';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'CAD') WHERE `code` = 'CA';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'CVE') WHERE `code` = 'CV';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'KYD') WHERE `code` = 'KY';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'CLP') WHERE `code` = 'CL';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'CNY') WHERE `code` = 'CN';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'COP') WHERE `code` = 'CO';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'KMF') WHERE `code` = 'KM';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'CDF') WHERE `code` = 'CD';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'CRC') WHERE `code` = 'CR';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'CUP') WHERE `code` = 'CU';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'ANG') WHERE `code` = 'CW';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'CZK') WHERE `code` = 'CZ';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'DKK') WHERE `code` = 'DK';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'DJF') WHERE `code` = 'DJ';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'XCD') WHERE `code` = 'DM';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'DOP') WHERE `code` = 'DO';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'EGP') WHERE `code` = 'EG';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'ERN') WHERE `code` = 'ER';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'ETB') WHERE `code` = 'ET';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'EUR') WHERE `code` = 'EU';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'FKP') WHERE `code` = 'FK';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'FJD') WHERE `code` = 'FJ';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'EUR') WHERE `code` = 'FR';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'XPF') WHERE `code` = 'PF';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'GMD') WHERE `code` = 'GM';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'GEL') WHERE `code` = 'GE';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'EUR') WHERE `code` = 'DE';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'GHS') WHERE `code` = 'GH';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'GIP') WHERE `code` = 'GI';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'GTQ') WHERE `code` = 'GT';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'GGP') WHERE `code` = 'GG';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'GNF') WHERE `code` = 'GN';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'GYD') WHERE `code` = 'GY';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'HTG') WHERE `code` = 'HT';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'HNL') WHERE `code` = 'HN';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'HKD') WHERE `code` = 'HK';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'HUF') WHERE `code` = 'HU';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'ISK') WHERE `code` = 'IS';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'IDR') WHERE `code` = 'ID';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'IRR') WHERE `code` = 'IR';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'IQD') WHERE `code` = 'IQ';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'IMP') WHERE `code` = 'IM';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'ILS') WHERE `code` = 'IL';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'JMD') WHERE `code` = 'JM';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'JPY') WHERE `code` = 'JP';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'JEP') WHERE `code` = 'JE';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'JOD') WHERE `code` = 'JO';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'KZT') WHERE `code` = 'KZ';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'KES') WHERE `code` = 'KE';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'KWD') WHERE `code` = 'KW';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'KGS') WHERE `code` = 'KG';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'LAK') WHERE `code` = 'LA';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'LBP') WHERE `code` = 'LB';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'LSL') WHERE `code` = 'LS';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'LRD') WHERE `code` = 'LR';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'LYD') WHERE `code` = 'LY';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'MGA') WHERE `code` = 'MG';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'MWK') WHERE `code` = 'MW';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'MYR') WHERE `code` = 'MY';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'MRU') WHERE `code` = 'MR';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'MUR') WHERE `code` = 'MU';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'MXN') WHERE `code` = 'MX';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'MDL') WHERE `code` = 'MD';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'MNT') WHERE `code` = 'MN';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'MAD') WHERE `code` = 'MA';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'MZN') WHERE `code` = 'MZ';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'MMK') WHERE `code` = 'MM';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'NAD') WHERE `code` = 'NA';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'NPR') WHERE `code` = 'NP';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'NZD') WHERE `code` = 'NZ';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'NGN') WHERE `code` = 'NG';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'KRW') WHERE `code` = 'KP';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'MKD') WHERE `code` = 'MK';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'NOK') WHERE `code` = 'NO';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'OMR') WHERE `code` = 'OM';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'PKR') WHERE `code` = 'PK';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'PAB') WHERE `code` = 'PA';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'PYG') WHERE `code` = 'PY';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'PEN') WHERE `code` = 'PE';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'PHP') WHERE `code` = 'PH';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'PLN') WHERE `code` = 'PL';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'QAR') WHERE `code` = 'QA';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'RON') WHERE `code` = 'RO';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'RUB') WHERE `code` = 'RU';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'RWF') WHERE `code` = 'RW';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'SHP') WHERE `code` = 'SH';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'STN') WHERE `code` = 'ST';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'SAR') WHERE `code` = 'SA';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'XOF') WHERE `code` = 'SN';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'RSD') WHERE `code` = 'RS';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'SCR') WHERE `code` = 'SC';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'SGD') WHERE `code` = 'SG';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'SBD') WHERE `code` = 'SB';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'SOS') WHERE `code` = 'SO';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'ZAR') WHERE `code` = 'ZA';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'KRW') WHERE `code` = 'KR';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'LKR') WHERE `code` = 'LK';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'SRD') WHERE `code` = 'SR';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'SEK') WHERE `code` = 'SE';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'CHF') WHERE `code` = 'CH';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'SYP') WHERE `code` = 'SY';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'TWD') WHERE `code` = 'TW';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'TZS') WHERE `code` = 'TZ';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'THB') WHERE `code` = 'TH';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'TTD') WHERE `code` = 'TT';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'TRY') WHERE `code` = 'TR';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'UGX') WHERE `code` = 'UG';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'UAH') WHERE `code` = 'UA';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'AED') WHERE `code` = 'AE';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'UYU') WHERE `code` = 'UY';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'UZS') WHERE `code` = 'UZ';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'VND') WHERE `code` = 'VN';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'YER') WHERE `code` = 'YE';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'ZMW') WHERE `code` = 'ZM';
UPDATE `countries` SET `default_currency_id` = (SELECT `id` FROM `currencies` WHERE `code` = 'ZWL') WHERE `code` = 'ZW';

-- =============================================================================
-- SYSTEM SETTINGS — Application defaults
-- =============================================================================
INSERT INTO `system_settings` (`setting_key`, `setting_value`, `type`, `category`, `description`) VALUES
    ('self_registration',           'false',          'gatekeeper', 'auth',        'Allow public self-registration'),
    ('require_email_verification',  'true',           'config',     'auth',        'Require email verification after registration'),
    ('auth_check_interval',         '300',            'config',     'auth',        'Auth check interval in seconds'),
    ('lockout_tier3_duration',      '7776000',        'config',     'auth',        'Tier 3 lockout duration in seconds (90 days)'),
    ('invite_expiry_days',          '7',              'config',     'invitations', 'Invite link expiry in days'),
    ('invite_requests_enabled',     'false',          'gatekeeper', 'invitations', 'Enable public invite request form'),
    ('plaid_enabled',               'false',          'gatekeeper', 'integrations','Enable Plaid bank integration'),
    ('ticker_price_ttl',            '86400',          'config',     'prices',      'Price cache TTL in seconds'),
    ('cache_mode',                  'instant_unlock',  'config',    'vault',       'Vault cache mode'),
    ('cache_ttl_hours',             '0',              'config',     'vault',       'Vault cache TTL in hours'),
    ('default_vault_tab',           'account',        'config',     'vault',       'Default active tab on vault page'),
    ('worker_mode',                 'count',          'config',     'workers',     'Worker dispatch mode'),
    ('worker_threshold',            '50',             'config',     'workers',     'Worker dispatch threshold'),
    ('worker_adaptive_ms',          '100',            'config',     'workers',     'Worker adaptive time in milliseconds');
