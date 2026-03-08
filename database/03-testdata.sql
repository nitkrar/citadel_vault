-- =============================================================================
-- Citadel Vault — Test Data
-- =============================================================================
-- Creates a test user and sample data for manual testing.
-- Run after 02-seed.sql.
--
-- IMPORTANT: Encrypted fields (name, amount, account_details, etc.) contain
-- plaintext placeholder values. This data is for schema/UI testing only.
-- The test user has no vault key — set it up on first login to test the
-- full encryption flow. Once vault is set up, this plaintext data will NOT
-- be readable through the UI (it expects encrypted values).
--
-- Credentials:
--   Username: testuser
--   Password: Test1234
-- =============================================================================

-- =============================================================================
-- TEST USER (id=2)
-- =============================================================================
-- Password: Test1234 (bcrypt cost 12)
INSERT INTO `users` (`username`, `email`, `password_hash`, `role`, `is_active`)
VALUES (
    'testuser',
    'test@citadel.local',
    '$2y$12$9a1jhrsBibgTrCuvcp4iYuT01Z9Iqp/uiI6nKqcahyrfKgCuNcIqS',
    'user',
    1
);

-- =============================================================================
-- SAMPLE ACCOUNTS (for user_id=2)
-- =============================================================================
-- Resolve currency and country IDs via subqueries for portability

-- UK Savings Account (GBP)
INSERT INTO `accounts` (`user_id`, `account_type_id`, `name`, `institution`, `country_id`, `currency_id`, `customer_id`, `account_details`, `comments`)
VALUES (
    2,
    (SELECT `id` FROM `account_types` WHERE `name` = 'Savings' LIMIT 1),
    'UK Savings',
    'Barclays Bank',
    (SELECT `id` FROM `countries` WHERE `code` = 'GB'),
    (SELECT `id` FROM `currencies` WHERE `code` = 'GBP'),
    'CUST-100234',
    '[{"name":"sort_code","value":"20-45-67"},{"name":"account_number","value":"12345678"}]',
    'Primary savings account'
);

-- US Checking Account (USD)
INSERT INTO `accounts` (`user_id`, `account_type_id`, `name`, `institution`, `country_id`, `currency_id`, `customer_id`, `account_details`, `comments`)
VALUES (
    2,
    (SELECT `id` FROM `account_types` WHERE `name` = 'Current / Checking' LIMIT 1),
    'US Checking',
    'Chase Bank',
    (SELECT `id` FROM `countries` WHERE `code` = 'US'),
    (SELECT `id` FROM `currencies` WHERE `code` = 'USD'),
    'ACC-9876543',
    '[{"name":"routing_number","value":"021000021"},{"name":"account_number","value":"9876543210"}]',
    'US checking for expenses'
);

-- India Savings Account (INR)
INSERT INTO `accounts` (`user_id`, `account_type_id`, `name`, `institution`, `country_id`, `currency_id`, `customer_id`, `account_details`, `comments`)
VALUES (
    2,
    (SELECT `id` FROM `account_types` WHERE `name` = 'Savings' LIMIT 1),
    'India Savings',
    'State Bank of India',
    (SELECT `id` FROM `countries` WHERE `code` = 'IN'),
    (SELECT `id` FROM `currencies` WHERE `code` = 'INR'),
    'SBI-44556677',
    '[{"name":"ifsc_code","value":"SBIN0001234"},{"name":"account_number","value":"1234567890123456"}]',
    'NRI savings account'
);

-- =============================================================================
-- SAMPLE ASSETS (for user_id=2)
-- =============================================================================

-- Cash Balance (GBP, linked to UK Savings account)
INSERT INTO `assets` (`user_id`, `account_id`, `asset_type_id`, `name`, `currency_id`, `country_id`, `amount`, `is_liquid`, `asset_data`, `comments`)
VALUES (
    2,
    (SELECT `id` FROM `accounts` WHERE `user_id` = 2 AND `name` = 'UK Savings' LIMIT 1),
    (SELECT `id` FROM `asset_types` WHERE `name` = 'Cash Balance' LIMIT 1),
    'Barclays Savings Balance',
    (SELECT `id` FROM `currencies` WHERE `code` = 'GBP'),
    (SELECT `id` FROM `countries` WHERE `code` = 'GB'),
    '15000.00',
    1,
    '[]',
    'Main emergency fund'
);

-- Equity / Stock (USD, standalone)
INSERT INTO `assets` (`user_id`, `asset_type_id`, `name`, `currency_id`, `country_id`, `amount`, `is_liquid`, `asset_data`, `comments`)
VALUES (
    2,
    (SELECT `id` FROM `asset_types` WHERE `name` = 'Equity / Stock' LIMIT 1),
    'Apple Inc.',
    (SELECT `id` FROM `currencies` WHERE `code` = 'USD'),
    (SELECT `id` FROM `countries` WHERE `code` = 'US'),
    '12500.00',
    1,
    '{"ticker":"AAPL","shares":"50","price_per_share":"250.00"}',
    '50 shares of AAPL'
);

-- Property (GBP)
INSERT INTO `assets` (`user_id`, `asset_type_id`, `name`, `currency_id`, `country_id`, `amount`, `is_liquid`, `asset_data`, `comments`)
VALUES (
    2,
    (SELECT `id` FROM `asset_types` WHERE `name` = 'Property' LIMIT 1),
    'London Flat',
    (SELECT `id` FROM `currencies` WHERE `code` = 'GBP'),
    (SELECT `id` FROM `countries` WHERE `code` = 'GB'),
    '450000.00',
    0,
    '{"address":"42 Baker Street, London NW1","purchase_price":"380000"}',
    'Primary residence'
);

-- Cryptocurrency (USD)
INSERT INTO `assets` (`user_id`, `asset_type_id`, `name`, `currency_id`, `country_id`, `amount`, `is_liquid`, `asset_data`, `comments`)
VALUES (
    2,
    (SELECT `id` FROM `asset_types` WHERE `name` = 'Cryptocurrency' LIMIT 1),
    'Bitcoin Holdings',
    (SELECT `id` FROM `currencies` WHERE `code` = 'USD'),
    NULL,
    '8500.00',
    1,
    '{"coin":"BTC","quantity":"0.1","wallet_address":"bc1q...example"}',
    'Cold storage wallet'
);

-- Debt / Liability (GBP)
INSERT INTO `assets` (`user_id`, `asset_type_id`, `name`, `currency_id`, `country_id`, `amount`, `is_liquid`, `is_liability`, `asset_data`, `comments`)
VALUES (
    2,
    (SELECT `id` FROM `asset_types` WHERE `name` = 'Debt / Liability' LIMIT 1),
    'Mortgage',
    (SELECT `id` FROM `currencies` WHERE `code` = 'GBP'),
    (SELECT `id` FROM `countries` WHERE `code` = 'GB'),
    '280000.00',
    0,
    1,
    '{"debt_type":"Mortgage","interest_rate":"4.5","emi":"1450","remaining_months":"240"}',
    'Mortgage on London flat'
);

-- =============================================================================
-- SAMPLE INSURANCE POLICY (for user_id=2)
-- =============================================================================
INSERT INTO `insurance_policies` (`user_id`, `policy_name`, `provider`, `policy_number`, `premium_amount`, `coverage_amount`, `start_date`, `maturity_date`, `payment_frequency`, `category`, `notes`)
VALUES (
    2,
    'Term Life Insurance',
    'Aviva',
    'POL-2024-88776',
    '45.00',
    '500000.00',
    '2024-01-15',
    '2049-01-15',
    'monthly',
    'Life',
    '25-year term life policy'
);

-- =============================================================================
-- SAMPLE LICENSE (for user_id=2)
-- =============================================================================
INSERT INTO `licenses` (`user_id`, `product_name`, `vendor`, `license_key_encrypted`, `purchase_date`, `expiry_date`, `seats`, `category`, `notes_encrypted`)
VALUES (
    2,
    'Microsoft 365 Family',
    'Microsoft',
    'XXXXX-XXXXX-XXXXX-XXXXX-XXXXX',
    '2025-06-01',
    '2026-06-01',
    6,
    'Software',
    'Annual family subscription'
);
