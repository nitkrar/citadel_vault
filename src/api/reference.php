<?php
/**
 * Personal Vault V2 — Reference Data API
 * Manages account types, asset types, countries, currencies, and exchange rate refresh.
 */
require_once __DIR__ . '/../core/Response.php';
require_once __DIR__ . '/../../config/config.php';
require_once __DIR__ . '/../core/Auth.php';
require_once __DIR__ . '/../core/ExchangeRates.php';
require_once __DIR__ . '/../core/Storage.php';

Response::setCors();
$payload = Auth::requireAuth();
$userId = Auth::userId($payload);
$isSiteAdmin = $payload['role'] === 'admin';
$method = $_SERVER['REQUEST_METHOD'];
$resource = $_GET['resource'] ?? '';
$id = isset($_GET['id']) ? (int)$_GET['id'] : null;
$storage = Storage::adapter();

// ============================================================================
// ACCOUNT TYPES (simplified — no is_liability, no json_schema)
// ============================================================================
if ($resource === 'account-types') {

    if ($method === 'GET') {
        Response::success($storage->getAccountTypes());
    }

    if ($method === 'POST') {
        $body = Response::getBody();
        $name        = Response::sanitize($body['name'] ?? '');
        $description = Response::sanitize($body['description'] ?? null);
        $icon        = Response::sanitize($body['icon'] ?? 'bank');

        if (!$name) {
            Response::error('Name is required.', 400);
        }

        $newId = $storage->createAccountType([
            'name'        => $name,
            'description' => $description,
            'icon'        => $icon,
            'created_by'  => $userId,
        ]);

        Response::success($storage->getAccountType($newId), 201);
    }

    if ($method === 'PUT') {
        if (!$id) {
            Response::error('Account type ID is required.', 400);
        }

        $type = $storage->getAccountType($id);
        if (!$type) {
            Response::error('Account type not found.', 404);
        }

        if (!$isSiteAdmin && $type['is_system']) {
            Response::error('You cannot modify system account types.', 403);
        }
        if (!$isSiteAdmin && (int)$type['created_by'] !== (int)$userId) {
            Response::error('You can only update account types you created.', 403);
        }

        $body = Response::getBody();
        $fields = [];

        if (isset($body['name'])) { $fields['name'] = Response::sanitize($body['name']); }
        if (isset($body['description'])) { $fields['description'] = Response::sanitize($body['description']); }
        if (isset($body['icon'])) { $fields['icon'] = Response::sanitize($body['icon']); }

        if (empty($fields)) {
            Response::error('No fields to update.', 400);
        }

        $storage->updateAccountType($id, $fields);
        Response::success($storage->getAccountType($id));
    }

    if ($method === 'DELETE') {
        if (!$id) { Response::error('Account type ID is required.', 400); }

        $type = $storage->getAccountType($id);
        if (!$type) { Response::error('Account type not found.', 404); }
        if ($type['is_system']) { Response::error('System account types cannot be deleted.', 403); }

        if ($storage->getAccountTypeUsageCount($id) > 0) {
            Response::error('Cannot delete: this account type is in use.', 409);
        }

        $storage->deleteAccountType($id);
        Response::success(['message' => 'Account type deleted.']);
    }

    Response::error('Method not allowed.', 405);
}

// ============================================================================
// ASSET TYPES (new)
// ============================================================================
if ($resource === 'asset-types') {

    if ($method === 'GET') {
        $rows = $storage->getAssetTypes();
        foreach ($rows as &$row) {
            if ($row['json_schema'] !== null) {
                $decoded = json_decode($row['json_schema'], true);
                $row['json_schema'] = $decoded !== null ? $decoded : $row['json_schema'];
            }
        }
        unset($row);
        Response::success($rows);
    }

    if ($method === 'POST') {
        $body = Response::getBody();
        $name     = Response::sanitize($body['name'] ?? '');
        $category = Response::sanitize($body['category'] ?? 'other');
        $icon     = Response::sanitize($body['icon'] ?? 'circle');
        $schema   = isset($body['json_schema']) ? json_encode($body['json_schema']) : '[]';

        if (!$name) { Response::error('Name is required.', 400); }

        $newId = $storage->createAssetType([
            'name'        => $name,
            'category'    => $category,
            'json_schema' => $schema,
            'icon'        => $icon,
            'created_by'  => $userId,
        ]);

        $row = $storage->getAssetType($newId);
        if ($row['json_schema'] !== null) {
            $decoded = json_decode($row['json_schema'], true);
            $row['json_schema'] = $decoded !== null ? $decoded : $row['json_schema'];
        }
        Response::success($row, 201);
    }

    if ($method === 'PUT') {
        if (!$id) { Response::error('Asset type ID is required.', 400); }

        $type = $storage->getAssetType($id);
        if (!$type) { Response::error('Asset type not found.', 404); }

        if (!$isSiteAdmin && $type['is_system']) {
            Response::error('You cannot modify system asset types.', 403);
        }
        if (!$isSiteAdmin && (int)$type['created_by'] !== (int)$userId) {
            Response::error('You can only update asset types you created.', 403);
        }

        $body = Response::getBody();
        $fields = [];

        if (isset($body['name'])) { $fields['name'] = Response::sanitize($body['name']); }
        if (isset($body['category'])) { $fields['category'] = Response::sanitize($body['category']); }
        if (isset($body['icon'])) { $fields['icon'] = Response::sanitize($body['icon']); }
        if (isset($body['json_schema'])) { $fields['json_schema'] = json_encode($body['json_schema']); }

        if (empty($fields)) { Response::error('No fields to update.', 400); }

        $storage->updateAssetType($id, $fields);
        $row = $storage->getAssetType($id);
        if ($row['json_schema'] !== null) {
            $decoded = json_decode($row['json_schema'], true);
            $row['json_schema'] = $decoded !== null ? $decoded : $row['json_schema'];
        }
        Response::success($row);
    }

    if ($method === 'DELETE') {
        if (!$id) { Response::error('Asset type ID is required.', 400); }

        $type = $storage->getAssetType($id);
        if (!$type) { Response::error('Asset type not found.', 404); }
        if ($type['is_system']) { Response::error('System asset types cannot be deleted.', 403); }

        if ($storage->getAssetTypeUsageCount($id) > 0) {
            Response::error('Cannot delete: this asset type is in use.', 409);
        }

        $storage->deleteAssetType($id);
        Response::success(['message' => 'Asset type deleted.']);
    }

    Response::error('Method not allowed.', 405);
}

// ============================================================================
// COUNTRIES
// ============================================================================
if ($resource === 'countries') {

    if ($method === 'GET') {
        $all = isset($_GET['all']) && $_GET['all'];
        Response::success($storage->getCountries($all));
    }

    if ($method === 'POST') {
        if (!$isSiteAdmin) { Response::error('Admin access required.', 403); }

        $body = Response::getBody();
        $name  = Response::sanitize($body['name'] ?? '');
        $code  = Response::sanitize($body['code'] ?? '');
        $flagEmoji         = Response::sanitize($body['flag_emoji'] ?? null);
        $defaultCurrencyId = isset($body['default_currency_id']) ? (int)$body['default_currency_id'] : null;

        if (!$name || !$code) { Response::error('Name and code are required.', 400); }

        $newId = $storage->createCountry([
            'name'                => $name,
            'code'                => $code,
            'flag_emoji'          => $flagEmoji,
            'default_currency_id' => $defaultCurrencyId,
        ]);

        Response::success($storage->getCountry($newId), 201);
    }

    if ($method === 'PUT') {
        if (!$isSiteAdmin) { Response::error('Admin access required.', 403); }
        if (!$id) { Response::error('Country ID is required.', 400); }

        if (!$storage->getCountry($id)) { Response::error('Country not found.', 404); }

        $body = Response::getBody();
        $fields = [];

        if (isset($body['name'])) { $fields['name'] = Response::sanitize($body['name']); }
        if (isset($body['code'])) { $fields['code'] = Response::sanitize($body['code']); }
        if (isset($body['flag_emoji'])) { $fields['flag_emoji'] = Response::sanitize($body['flag_emoji']); }
        if (array_key_exists('is_active', $body)) { $fields['is_active'] = (int)(bool)$body['is_active']; }
        if (array_key_exists('default_currency_id', $body)) {
            $fields['default_currency_id'] = $body['default_currency_id'] !== null ? (int)$body['default_currency_id'] : null;
        }

        if (empty($fields)) { Response::error('No fields to update.', 400); }

        $storage->updateCountry($id, $fields);
        Response::success($storage->getCountry($id));
    }

    if ($method === 'DELETE') {
        if (!$isSiteAdmin) { Response::error('Admin access required.', 403); }
        if (!$id) { Response::error('Country ID is required.', 400); }

        if (!$storage->getCountry($id)) { Response::error('Country not found.', 404); }

        if ($storage->getCountryUsageCount($id) > 0) {
            Response::error('Cannot delete: this country is in use.', 409);
        }

        $storage->deleteCountry($id);
        Response::success(['message' => 'Country deleted.']);
    }

    Response::error('Method not allowed.', 405);
}

// ============================================================================
// CURRENCIES
// ============================================================================
if ($resource === 'currencies') {

    if ($method === 'GET') {
        $all = isset($_GET['all']) && $_GET['all'] === '1' && $isSiteAdmin;
        Response::success($storage->getCurrencies($all));
    }

    if ($method === 'POST') {
        if (!$isSiteAdmin) { Response::error('Admin access required.', 403); }

        $body = Response::getBody();
        $name   = Response::sanitize($body['name'] ?? '');
        $code   = Response::sanitize($body['code'] ?? '');
        $symbol = Response::sanitize($body['symbol'] ?? '');
        $exchangeRate = isset($body['exchange_rate_to_base']) ? (float)$body['exchange_rate_to_base'] : 1.0;
        $isActive = isset($body['is_active']) ? (int)(bool)$body['is_active'] : 1;

        if (!$name || !$code || !$symbol) { Response::error('Name, code, and symbol are required.', 400); }

        $newId = $storage->createCurrency([
            'name'                 => $name,
            'code'                 => $code,
            'symbol'               => $symbol,
            'is_active'            => $isActive,
            'exchange_rate_to_base' => $exchangeRate,
        ]);

        Response::success($storage->getCurrency($newId), 201);
    }

    if ($method === 'PUT') {
        if (!$isSiteAdmin) { Response::error('Admin access required.', 403); }
        if (!$id) { Response::error('Currency ID is required.', 400); }

        if (!$storage->getCurrency($id)) { Response::error('Currency not found.', 404); }

        $body = Response::getBody();
        $fields = [];

        if (isset($body['name'])) { $fields['name'] = Response::sanitize($body['name']); }
        if (isset($body['code'])) { $fields['code'] = Response::sanitize($body['code']); }
        if (isset($body['symbol'])) { $fields['symbol'] = Response::sanitize($body['symbol']); }
        if (isset($body['exchange_rate_to_base'])) { $fields['exchange_rate_to_base'] = (float)$body['exchange_rate_to_base']; }
        if (array_key_exists('is_active', $body)) { $fields['is_active'] = (int)(bool)$body['is_active']; }

        if (empty($fields)) { Response::error('No fields to update.', 400); }

        $storage->updateCurrency($id, $fields);
        Response::success($storage->getCurrency($id));
    }

    Response::error('Method not allowed.', 405);
}

// ============================================================================
// REFRESH EXCHANGE RATES
// ============================================================================
if ($resource === 'refresh-rates') {
    if ($method !== 'POST') { Response::error('Method not allowed.', 405); }
    if (!$isSiteAdmin) { Response::error('Admin access required.', 403); }

    if (!EXCHANGE_RATE_API_KEY) { Response::error('Exchange rate API key is not configured.', 500); }

    $result = ExchangeRates::refresh();

    if ($result['skipped']) {
        Response::error('Failed to refresh rates: ' . ($result['reason'] ?? 'unknown'), 502);
    }

    Response::success([
        'message' => 'Exchange rates refreshed successfully.',
        'updated_count' => $result['updated'],
        'base_currency' => BASE_CURRENCY,
    ]);
}

// ============================================================================
// HISTORICAL RATES — Read from currency_rate_history by date
// ============================================================================
if ($resource === 'historical-rates') {
    if ($method === 'GET') {
        $date = Response::sanitizeDate($_GET['date'] ?? null);
        if (!$date) {
            Response::error('Valid date (YYYY-MM-DD) is required.', 400);
        }

        $rows = $storage->getHistoricalRates($date);

        if (empty($rows)) {
            Response::error('No rates found for this date.', 404);
        }

        $rates = [];
        $baseCurrency = $rows[0]['base_currency'];
        foreach ($rows as $row) {
            $rates[$row['code']] = (float)$row['rate_to_base'];
        }

        Response::success([
            'date'          => $date,
            'base_currency' => $baseCurrency,
            'rates'         => $rates,
        ]);
    }
    Response::error('Method not allowed.', 405);
}

// ============================================================================
// EXCHANGES — Stock exchange reference data
// ============================================================================
if ($resource === 'exchanges') {
    if ($method === 'GET') {
        Response::success($storage->getExchanges());
    }

    // Admin-only writes
    if (!$isSiteAdmin) {
        Response::error('Admin access required.', 403);
    }

    if ($method === 'POST') {
        $body = Response::getBody();
        $countryCode = Response::sanitize($body['country_code'] ?? '');
        $name = Response::sanitize($body['name'] ?? '');
        $suffix = Response::sanitize($body['suffix'] ?? '');
        $displayOrder = (int)($body['display_order'] ?? 0);

        if (!$countryCode || !$name) {
            Response::error('country_code and name are required.', 400);
        }

        $newId = $storage->createExchange([
            'country_code'  => $countryCode,
            'name'          => $name,
            'suffix'        => $suffix,
            'display_order' => $displayOrder,
        ]);

        Response::success($storage->getExchange($newId), 201);
    }

    if ($method === 'PUT') {
        if (!$id) Response::error('Exchange ID required.', 400);

        $body = Response::getBody();
        $allowed = ['country_code', 'name', 'suffix', 'display_order'];
        $fields = [];

        foreach ($allowed as $field) {
            if (array_key_exists($field, $body)) {
                $fields[$field] = $field === 'display_order' ? (int)$body[$field] : Response::sanitize($body[$field]);
            }
        }

        if (empty($fields)) {
            Response::error('No fields to update.', 400);
        }

        $storage->updateExchange($id, $fields);

        $updated = $storage->getExchange($id);
        if (!$updated) Response::error('Exchange not found.', 404);

        Response::success($updated);
    }

    if ($method === 'DELETE') {
        if (!$id) Response::error('Exchange ID required.', 400);

        if (!$storage->deleteExchange($id)) {
            Response::error('Exchange not found.', 404);
        }

        Response::success(['deleted' => true]);
    }

    Response::error('Method not allowed.', 405);
}

// ============================================================================
// CONFIG — Expose server configuration to client
// ============================================================================
if ($resource === 'config') {
    if ($method === 'GET') {
        $systemSettings = $storage->getSystemSettings();
        Response::success(array_merge(
            ['base_currency' => BASE_CURRENCY],
            $systemSettings
        ));
    }
    Response::error('Method not allowed.', 405);
}

Response::error('Invalid resource.', 404);
