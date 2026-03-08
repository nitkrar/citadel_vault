-- =============================================================================
-- Citadel Vault — Seed Data
-- =============================================================================
-- System users, currencies, countries, account types, and asset types.
-- Run after 01-schema.sql.
-- =============================================================================

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";

-- =============================================================================
-- SYSTEM USERS
-- =============================================================================

-- Ghost user (id=0): sentinel for global templates and unresolvable share recipients
INSERT INTO `users` (`id`, `username`, `email`, `password_hash`, `role`, `is_active`, `public_key`)
VALUES (0, '__ghost__', 'ghost@system.internal', '', 'ghost', 0, NULL);

-- Site admin (id=1): default administrator, must change password on first login
-- Default password: Citadel@2024 (bcrypt cost 12)
INSERT INTO `users` (`username`, `email`, `password_hash`, `role`, `must_change_password`, `is_active`)
VALUES (
    'citadel_site_admin',
    'admin@localhost',
    '$2y$12$7wv8yGgAxWFTFultxJtvuONCO2uENuqsuicY37eal958TRwkf665S',
    'site_admin',
    1,
    1
);

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
INSERT INTO `countries` (`name`, `code`, `flag_emoji`, `display_order`, `field_template`) VALUES
-- Pinned countries (with banking field templates)
('United Kingdom',       'GB', '🇬🇧',   1, '{"fields":[{"name":"sort_code","label":"Sort Code","type":"text","placeholder":"00-00-00"},{"name":"account_number","label":"Account Number","type":"text","placeholder":"12345678"}]}'),
('India',                'IN', '🇮🇳',   2, '{"fields":[{"name":"ifsc_code","label":"IFSC Code","type":"text","placeholder":"ABCD0123456"},{"name":"account_number","label":"Account Number","type":"text","placeholder":"1234567890123456"}]}'),
('United States',        'US', '🇺🇸',   3, '{"fields":[{"name":"routing_number","label":"Routing Number","type":"text","placeholder":"123456789"},{"name":"account_number","label":"Account Number","type":"text","placeholder":"1234567890"}]}'),
-- All other countries (alphabetical)
('Afghanistan',              'AF', '🇦🇫', 999, NULL),
('Albania',                  'AL', '🇦🇱', 999, NULL),
('Algeria',                  'DZ', '🇩🇿', 999, NULL),
('Angola',                   'AO', '🇦🇴', 999, NULL),
('Argentina',                'AR', '🇦🇷', 999, NULL),
('Armenia',                  'AM', '🇦🇲', 999, NULL),
('Aruba',                    'AW', '🇦🇼', 999, NULL),
('Australia',                'AU', '🇦🇺', 999, NULL),
('Azerbaijan',               'AZ', '🇦🇿', 999, NULL),
('Bahamas',                  'BS', '🇧🇸', 999, NULL),
('Bahrain',                  'BH', '🇧🇭', 999, NULL),
('Bangladesh',               'BD', '🇧🇩', 999, NULL),
('Barbados',                 'BB', '🇧🇧', 999, NULL),
('Belarus',                  'BY', '🇧🇾', 999, NULL),
('Belize',                   'BZ', '🇧🇿', 999, NULL),
('Bermuda',                  'BM', '🇧🇲', 999, NULL),
('Bolivia',                  'BO', '🇧🇴', 999, NULL),
('Bosnia and Herzegovina',   'BA', '🇧🇦', 999, NULL),
('Botswana',                 'BW', '🇧🇼', 999, NULL),
('Brazil',                   'BR', '🇧🇷', 999, NULL),
('Brunei',                   'BN', '🇧🇳', 999, NULL),
('Bulgaria',                 'BG', '🇧🇬', 999, NULL),
('Burundi',                  'BI', '🇧🇮', 999, NULL),
('Cambodia',                 'KH', '🇰🇭', 999, NULL),
('Cameroon',                 'CM', '🇨🇲', 999, NULL),
('Canada',                   'CA', '🇨🇦', 999, NULL),
('Cape Verde',               'CV', '🇨🇻', 999, NULL),
('Cayman Islands',           'KY', '🇰🇾', 999, NULL),
('Chile',                    'CL', '🇨🇱', 999, NULL),
('China',                    'CN', '🇨🇳', 999, NULL),
('Colombia',                 'CO', '🇨🇴', 999, NULL),
('Comoros',                  'KM', '🇰🇲', 999, NULL),
('Congo (DRC)',              'CD', '🇨🇩', 999, NULL),
('Costa Rica',               'CR', '🇨🇷', 999, NULL),
('Cuba',                     'CU', '🇨🇺', 999, NULL),
('Curaçao',                  'CW', '🇨🇼', 999, NULL),
('Czech Republic',           'CZ', '🇨🇿', 999, NULL),
('Denmark',                  'DK', '🇩🇰', 999, NULL),
('Djibouti',                 'DJ', '🇩🇯', 999, NULL),
('Dominica',                 'DM', '🇩🇲', 999, NULL),
('Dominican Republic',       'DO', '🇩🇴', 999, NULL),
('Egypt',                    'EG', '🇪🇬', 999, NULL),
('Eritrea',                  'ER', '🇪🇷', 999, NULL),
('Ethiopia',                 'ET', '🇪🇹', 999, NULL),
('European Union',           'EU', '🇪🇺', 999, NULL),
('Falkland Islands',         'FK', '🇫🇰', 999, NULL),
('Fiji',                     'FJ', '🇫🇯', 999, NULL),
('France',                   'FR', '🇫🇷', 999, NULL),
('French Polynesia',         'PF', '🇵🇫', 999, NULL),
('Gambia',                   'GM', '🇬🇲', 999, NULL),
('Georgia',                  'GE', '🇬🇪', 999, NULL),
('Germany',                  'DE', '🇩🇪', 999, NULL),
('Ghana',                    'GH', '🇬🇭', 999, NULL),
('Gibraltar',                'GI', '🇬🇮', 999, NULL),
('Guatemala',                'GT', '🇬🇹', 999, NULL),
('Guernsey',                 'GG', '🇬🇬', 999, NULL),
('Guinea',                   'GN', '🇬🇳', 999, NULL),
('Guyana',                   'GY', '🇬🇾', 999, NULL),
('Haiti',                    'HT', '🇭🇹', 999, NULL),
('Honduras',                 'HN', '🇭🇳', 999, NULL),
('Hong Kong',                'HK', '🇭🇰', 999, NULL),
('Hungary',                  'HU', '🇭🇺', 999, NULL),
('Iceland',                  'IS', '🇮🇸', 999, NULL),
('Indonesia',                'ID', '🇮🇩', 999, NULL),
('Iran',                     'IR', '🇮🇷', 999, NULL),
('Iraq',                     'IQ', '🇮🇶', 999, NULL),
('Isle of Man',              'IM', '🇮🇲', 999, NULL),
('Israel',                   'IL', '🇮🇱', 999, NULL),
('Jamaica',                  'JM', '🇯🇲', 999, NULL),
('Japan',                    'JP', '🇯🇵', 999, NULL),
('Jersey',                   'JE', '🇯🇪', 999, NULL),
('Jordan',                   'JO', '🇯🇴', 999, NULL),
('Kazakhstan',               'KZ', '🇰🇿', 999, NULL),
('Kenya',                    'KE', '🇰🇪', 999, NULL),
('Kuwait',                   'KW', '🇰🇼', 999, NULL),
('Kyrgyzstan',               'KG', '🇰🇬', 999, NULL),
('Laos',                     'LA', '🇱🇦', 999, NULL),
('Lebanon',                  'LB', '🇱🇧', 999, NULL),
('Lesotho',                  'LS', '🇱🇸', 999, NULL),
('Liberia',                  'LR', '🇱🇷', 999, NULL),
('Libya',                    'LY', '🇱🇾', 999, NULL),
('Madagascar',               'MG', '🇲🇬', 999, NULL),
('Malawi',                   'MW', '🇲🇼', 999, NULL),
('Malaysia',                 'MY', '🇲🇾', 999, NULL),
('Mauritania',               'MR', '🇲🇷', 999, NULL),
('Mauritius',                'MU', '🇲🇺', 999, NULL),
('Mexico',                   'MX', '🇲🇽', 999, NULL),
('Moldova',                  'MD', '🇲🇩', 999, NULL),
('Mongolia',                 'MN', '🇲🇳', 999, NULL),
('Morocco',                  'MA', '🇲🇦', 999, NULL),
('Mozambique',               'MZ', '🇲🇿', 999, NULL),
('Myanmar',                  'MM', '🇲🇲', 999, NULL),
('Namibia',                  'NA', '🇳🇦', 999, NULL),
('Nepal',                    'NP', '🇳🇵', 999, NULL),
('New Zealand',              'NZ', '🇳🇿', 999, NULL),
('Nigeria',                  'NG', '🇳🇬', 999, NULL),
('North Korea',              'KP', '🇰🇵', 999, NULL),
('North Macedonia',          'MK', '🇲🇰', 999, NULL),
('Norway',                   'NO', '🇳🇴', 999, NULL),
('Oman',                     'OM', '🇴🇲', 999, NULL),
('Pakistan',                 'PK', '🇵🇰', 999, NULL),
('Panama',                   'PA', '🇵🇦', 999, NULL),
('Paraguay',                 'PY', '🇵🇾', 999, NULL),
('Peru',                     'PE', '🇵🇪', 999, NULL),
('Philippines',              'PH', '🇵🇭', 999, NULL),
('Poland',                   'PL', '🇵🇱', 999, NULL),
('Qatar',                    'QA', '🇶🇦', 999, NULL),
('Romania',                  'RO', '🇷🇴', 999, NULL),
('Russia',                   'RU', '🇷🇺', 999, NULL),
('Rwanda',                   'RW', '🇷🇼', 999, NULL),
('Saint Helena',             'SH', '🇸🇭', 999, NULL),
('Sao Tome and Principe',    'ST', '🇸🇹', 999, NULL),
('Saudi Arabia',             'SA', '🇸🇦', 999, NULL),
('Senegal',                  'SN', '🇸🇳', 999, NULL),
('Serbia',                   'RS', '🇷🇸', 999, NULL),
('Seychelles',               'SC', '🇸🇨', 999, NULL),
('Singapore',                'SG', '🇸🇬', 999, NULL),
('Solomon Islands',          'SB', '🇸🇧', 999, NULL),
('Somalia',                  'SO', '🇸🇴', 999, NULL),
('South Africa',             'ZA', '🇿🇦', 999, NULL),
('South Korea',              'KR', '🇰🇷', 999, NULL),
('Sri Lanka',                'LK', '🇱🇰', 999, NULL),
('Suriname',                 'SR', '🇸🇷', 999, NULL),
('Sweden',                   'SE', '🇸🇪', 999, NULL),
('Switzerland',              'CH', '🇨🇭', 999, NULL),
('Syria',                    'SY', '🇸🇾', 999, NULL),
('Taiwan',                   'TW', '🇹🇼', 999, NULL),
('Tanzania',                 'TZ', '🇹🇿', 999, NULL),
('Thailand',                 'TH', '🇹🇭', 999, NULL),
('Trinidad and Tobago',      'TT', '🇹🇹', 999, NULL),
('Turkey',                   'TR', '🇹🇷', 999, NULL),
('Uganda',                   'UG', '🇺🇬', 999, NULL),
('Ukraine',                  'UA', '🇺🇦', 999, NULL),
('United Arab Emirates',     'AE', '🇦🇪', 999, NULL),
('Uruguay',                  'UY', '🇺🇾', 999, NULL),
('Uzbekistan',               'UZ', '🇺🇿', 999, NULL),
('Vietnam',                  'VN', '🇻🇳', 999, NULL),
('Yemen',                    'YE', '🇾🇪', 999, NULL),
('Zambia',                   'ZM', '🇿🇲', 999, NULL),
('Zimbabwe',                 'ZW', '🇿🇼', 999, NULL);

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
-- ACCOUNT TYPES (7 system types)
-- =============================================================================
INSERT INTO `account_types` (`name`, `description`, `icon`, `is_system`) VALUES
('Current / Checking', 'Standard current or checking account for daily transactions', 'bank', 1),
('Savings',            'Interest-bearing savings account',                            'piggy-bank', 1),
('Brokerage / Trading','General investment, brokerage, or trading account',           'trending-up', 1),
('Credit Card',        'Credit card account',                                         'credit-card', 1),
('Loan Account',       'Loan or mortgage account',                                    'file-text', 1),
('Wallet / Prepaid',   'Digital wallet or prepaid card',                              'wallet', 1),
('Fixed Deposit',      'Fixed deposit or term deposit account',                       'lock', 1);

-- =============================================================================
-- ASSET TYPES (12 system types with json_schema)
-- =============================================================================
INSERT INTO `asset_types` (`name`, `category`, `json_schema`, `icon`, `is_system`) VALUES
('Cash Balance',       'cash',            '[]', 'banknote', 1),
('Equity / Stock',     'equity',          '[{"key":"ticker","label":"Ticker Symbol","type":"text","required":true},{"key":"shares","label":"Shares","type":"number","required":true},{"key":"price_per_share","label":"Price per Share","type":"number"}]', 'trending-up', 1),
('Mutual Fund',        'fund',            '[{"key":"fund_name","label":"Fund Name","type":"text"},{"key":"units","label":"Units","type":"number"},{"key":"nav","label":"NAV","type":"number"}]', 'pie-chart', 1),
('Fixed Deposit',      'fixed_deposit',   '[{"key":"principal","label":"Principal Amount","type":"number","required":true},{"key":"interest_rate","label":"Interest Rate (%)","type":"number"},{"key":"maturity_date","label":"Maturity Date","type":"date"}]', 'lock', 1),
('Bond',               'bond',            '[{"key":"issuer","label":"Issuer","type":"text"},{"key":"coupon_rate","label":"Coupon Rate (%)","type":"number"},{"key":"maturity_date","label":"Maturity Date","type":"date"}]', 'file-text', 1),
('Property',           'property',        '[{"key":"address","label":"Address","type":"text"},{"key":"purchase_price","label":"Purchase Price","type":"number"}]', 'home', 1),
('Gold / Precious Metal','gold',          '[{"key":"weight_grams","label":"Weight (grams)","type":"number"},{"key":"purity","label":"Purity","type":"text"}]', 'gem', 1),
('Cryptocurrency',     'crypto',          '[{"key":"coin","label":"Coin/Token","type":"text","required":true},{"key":"quantity","label":"Quantity","type":"number","required":true},{"key":"wallet_address","label":"Wallet Address","type":"text"}]', 'bitcoin', 1),
('Loan Given',         'loan_given',      '[{"key":"borrower","label":"Borrower","type":"text"},{"key":"interest_rate","label":"Interest Rate (%)","type":"number"},{"key":"due_date","label":"Due Date","type":"date"}]', 'hand-coins', 1),
('Debt / Liability',   'debt',            '[{"key":"debt_type","label":"Debt Type","type":"text"},{"key":"interest_rate","label":"Interest Rate (%)","type":"number"},{"key":"emi","label":"EMI/Monthly Payment","type":"number"},{"key":"remaining_months","label":"Remaining Months","type":"number"}]', 'alert-triangle', 1),
('Cash Equivalent',    'cash_equivalent', '[]', 'wallet', 1),
('Other',              'other',           '[]', 'circle', 1);
