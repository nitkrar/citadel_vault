<?php
/**
 * Personal Vault V2 — Reference Data API
 * Manages account types, asset types, countries, currencies, and exchange rate refresh.
 */
require_once __DIR__ . '/../core/Response.php';
require_once __DIR__ . '/../../config/config.php';
require_once __DIR__ . '/../core/Auth.php';
require_once __DIR__ . '/../core/ExchangeRates.php';

Response::setCors();
$payload = Auth::requireAuth();
$userId = $payload['sub'];
$isSiteAdmin = $payload['role'] === 'admin';
$method = $_SERVER['REQUEST_METHOD'];
$resource = $_GET['resource'] ?? '';
$id = isset($_GET['id']) ? (int)$_GET['id'] : null;
$db = Database::getInstance();

// ============================================================================
// ACCOUNT TYPES (simplified — no is_liability, no json_schema)
// ============================================================================
if ($resource === 'account-types') {

    if ($method === 'GET') {
        $stmt = $db->query("SELECT * FROM account_types ORDER BY is_system DESC, name ASC");
        Response::success($stmt->fetchAll());
    }

    if ($method === 'POST') {
        $body = Response::getBody();
        $name        = Response::sanitize($body['name'] ?? '');
        $description = Response::sanitize($body['description'] ?? null);
        $icon        = Response::sanitize($body['icon'] ?? 'bank');

        if (!$name) {
            Response::error('Name is required.', 400);
        }

        $stmt = $db->prepare(
            "INSERT INTO account_types (name, description, icon, created_by, is_system)
             VALUES (?, ?, ?, ?, 0)"
        );
        $stmt->execute([$name, $description, $icon, $userId]);
        $newId = (int)$db->lastInsertId();

        $stmt = $db->prepare("SELECT * FROM account_types WHERE id = ?");
        $stmt->execute([$newId]);
        Response::success($stmt->fetch(), 201);
    }

    if ($method === 'PUT') {
        if (!$id) {
            Response::error('Account type ID is required.', 400);
        }

        $stmt = $db->prepare("SELECT * FROM account_types WHERE id = ?");
        $stmt->execute([$id]);
        $type = $stmt->fetch();
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
        $params = [];

        if (isset($body['name'])) { $fields[] = 'name = ?'; $params[] = Response::sanitize($body['name']); }
        if (isset($body['description'])) { $fields[] = 'description = ?'; $params[] = Response::sanitize($body['description']); }
        if (isset($body['icon'])) { $fields[] = 'icon = ?'; $params[] = Response::sanitize($body['icon']); }

        if (empty($fields)) {
            Response::error('No fields to update.', 400);
        }

        $params[] = $id;
        $stmt = $db->prepare("UPDATE account_types SET " . implode(', ', $fields) . " WHERE id = ?");
        $stmt->execute($params);

        $stmt = $db->prepare("SELECT * FROM account_types WHERE id = ?");
        $stmt->execute([$id]);
        Response::success($stmt->fetch());
    }

    if ($method === 'DELETE') {
        if (!$id) { Response::error('Account type ID is required.', 400); }

        $stmt = $db->prepare("SELECT * FROM account_types WHERE id = ?");
        $stmt->execute([$id]);
        $type = $stmt->fetch();
        if (!$type) { Response::error('Account type not found.', 404); }
        if ($type['is_system']) { Response::error('System account types cannot be deleted.', 403); }

        $stmt = $db->prepare("SELECT COUNT(*) AS cnt FROM accounts WHERE account_type_id = ?");
        $stmt->execute([$id]);
        if ((int)$stmt->fetch()['cnt'] > 0) {
            Response::error('Cannot delete: this account type is in use.', 409);
        }

        $stmt = $db->prepare("DELETE FROM account_types WHERE id = ?");
        $stmt->execute([$id]);
        Response::success(['message' => 'Account type deleted.']);
    }

    Response::error('Method not allowed.', 405);
}

// ============================================================================
// ASSET TYPES (new)
// ============================================================================
if ($resource === 'asset-types') {

    if ($method === 'GET') {
        $stmt = $db->query("SELECT * FROM asset_types ORDER BY is_system DESC, name ASC");
        $rows = $stmt->fetchAll();
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

        $stmt = $db->prepare(
            "INSERT INTO asset_types (name, category, json_schema, icon, created_by, is_system)
             VALUES (?, ?, ?, ?, ?, 0)"
        );
        $stmt->execute([$name, $category, $schema, $icon, $userId]);
        $newId = (int)$db->lastInsertId();

        $stmt = $db->prepare("SELECT * FROM asset_types WHERE id = ?");
        $stmt->execute([$newId]);
        $row = $stmt->fetch();
        if ($row['json_schema'] !== null) {
            $decoded = json_decode($row['json_schema'], true);
            $row['json_schema'] = $decoded !== null ? $decoded : $row['json_schema'];
        }
        Response::success($row, 201);
    }

    if ($method === 'PUT') {
        if (!$id) { Response::error('Asset type ID is required.', 400); }

        $stmt = $db->prepare("SELECT * FROM asset_types WHERE id = ?");
        $stmt->execute([$id]);
        $type = $stmt->fetch();
        if (!$type) { Response::error('Asset type not found.', 404); }

        if (!$isSiteAdmin && $type['is_system']) {
            Response::error('You cannot modify system asset types.', 403);
        }
        if (!$isSiteAdmin && (int)$type['created_by'] !== (int)$userId) {
            Response::error('You can only update asset types you created.', 403);
        }

        $body = Response::getBody();
        $fields = [];
        $params = [];

        if (isset($body['name'])) { $fields[] = 'name = ?'; $params[] = Response::sanitize($body['name']); }
        if (isset($body['category'])) { $fields[] = 'category = ?'; $params[] = Response::sanitize($body['category']); }
        if (isset($body['icon'])) { $fields[] = 'icon = ?'; $params[] = Response::sanitize($body['icon']); }
        if (isset($body['json_schema'])) { $fields[] = 'json_schema = ?'; $params[] = json_encode($body['json_schema']); }

        if (empty($fields)) { Response::error('No fields to update.', 400); }

        $params[] = $id;
        $stmt = $db->prepare("UPDATE asset_types SET " . implode(', ', $fields) . " WHERE id = ?");
        $stmt->execute($params);

        $stmt = $db->prepare("SELECT * FROM asset_types WHERE id = ?");
        $stmt->execute([$id]);
        $row = $stmt->fetch();
        if ($row['json_schema'] !== null) {
            $decoded = json_decode($row['json_schema'], true);
            $row['json_schema'] = $decoded !== null ? $decoded : $row['json_schema'];
        }
        Response::success($row);
    }

    if ($method === 'DELETE') {
        if (!$id) { Response::error('Asset type ID is required.', 400); }

        $stmt = $db->prepare("SELECT * FROM asset_types WHERE id = ?");
        $stmt->execute([$id]);
        $type = $stmt->fetch();
        if (!$type) { Response::error('Asset type not found.', 404); }
        if ($type['is_system']) { Response::error('System asset types cannot be deleted.', 403); }

        $stmt = $db->prepare("SELECT COUNT(*) AS cnt FROM assets WHERE asset_type_id = ?");
        $stmt->execute([$id]);
        if ((int)$stmt->fetch()['cnt'] > 0) {
            Response::error('Cannot delete: this asset type is in use.', 409);
        }

        $stmt = $db->prepare("DELETE FROM asset_types WHERE id = ?");
        $stmt->execute([$id]);
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
        $where = $all ? '' : 'WHERE IFNULL(c.is_active, 1) = 1';
        $stmt = $db->query(
            "SELECT c.id, c.name, c.code, c.flag_emoji, c.display_order, c.is_active, c.default_currency_id,
                    cu.code AS default_currency_code, cu.symbol AS default_currency_symbol
             FROM countries c
             LEFT JOIN currencies cu ON c.default_currency_id = cu.id
             $where
             ORDER BY c.display_order ASC, c.name ASC"
        );
        Response::success($stmt->fetchAll());
    }

    if ($method === 'POST') {
        if (!$isSiteAdmin) { Response::error('Admin access required.', 403); }

        $body = Response::getBody();
        $name  = Response::sanitize($body['name'] ?? '');
        $code  = Response::sanitize($body['code'] ?? '');
        $flagEmoji         = Response::sanitize($body['flag_emoji'] ?? null);
        $defaultCurrencyId = isset($body['default_currency_id']) ? (int)$body['default_currency_id'] : null;

        if (!$name || !$code) { Response::error('Name and code are required.', 400); }

        $stmt = $db->prepare(
            "INSERT INTO countries (name, code, flag_emoji, default_currency_id)
             VALUES (?, ?, ?, ?)"
        );
        $stmt->execute([$name, $code, $flagEmoji, $defaultCurrencyId]);
        $newId = (int)$db->lastInsertId();

        $stmt = $db->prepare("SELECT * FROM countries WHERE id = ?");
        $stmt->execute([$newId]);
        Response::success($stmt->fetch(), 201);
    }

    if ($method === 'PUT') {
        if (!$isSiteAdmin) { Response::error('Admin access required.', 403); }
        if (!$id) { Response::error('Country ID is required.', 400); }

        $stmt = $db->prepare("SELECT * FROM countries WHERE id = ?");
        $stmt->execute([$id]);
        if (!$stmt->fetch()) { Response::error('Country not found.', 404); }

        $body = Response::getBody();
        $fields = [];
        $params = [];

        if (isset($body['name'])) { $fields[] = 'name = ?'; $params[] = Response::sanitize($body['name']); }
        if (isset($body['code'])) { $fields[] = 'code = ?'; $params[] = Response::sanitize($body['code']); }
        if (isset($body['flag_emoji'])) { $fields[] = 'flag_emoji = ?'; $params[] = Response::sanitize($body['flag_emoji']); }
        if (array_key_exists('is_active', $body)) { $fields[] = 'is_active = ?'; $params[] = (int)(bool)$body['is_active']; }
        if (array_key_exists('default_currency_id', $body)) {
            $fields[] = 'default_currency_id = ?';
            $params[] = $body['default_currency_id'] !== null ? (int)$body['default_currency_id'] : null;
        }

        if (empty($fields)) { Response::error('No fields to update.', 400); }

        $params[] = $id;
        $stmt = $db->prepare("UPDATE countries SET " . implode(', ', $fields) . " WHERE id = ?");
        $stmt->execute($params);

        $stmt = $db->prepare("SELECT * FROM countries WHERE id = ?");
        $stmt->execute([$id]);
        Response::success($stmt->fetch());
    }

    if ($method === 'DELETE') {
        if (!$isSiteAdmin) { Response::error('Admin access required.', 403); }
        if (!$id) { Response::error('Country ID is required.', 400); }

        $stmt = $db->prepare("SELECT * FROM countries WHERE id = ?");
        $stmt->execute([$id]);
        if (!$stmt->fetch()) { Response::error('Country not found.', 404); }

        $stmt = $db->prepare("SELECT COUNT(*) AS cnt FROM accounts WHERE country_id = ?");
        $stmt->execute([$id]);
        if ((int)$stmt->fetch()['cnt'] > 0) {
            Response::error('Cannot delete: this country is in use.', 409);
        }

        $stmt = $db->prepare("DELETE FROM countries WHERE id = ?");
        $stmt->execute([$id]);
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
        if ($all) {
            $stmt = $db->query("SELECT * FROM currencies ORDER BY display_order ASC, name ASC");
        } else {
            $stmt = $db->query("SELECT * FROM currencies WHERE IFNULL(is_active, 1) = 1 ORDER BY display_order ASC, name ASC");
        }
        Response::success($stmt->fetchAll());
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

        $stmt = $db->prepare(
            "INSERT INTO currencies (name, code, symbol, is_active, exchange_rate_to_base) VALUES (?, ?, ?, ?, ?)"
        );
        $stmt->execute([$name, $code, $symbol, $isActive, $exchangeRate]);
        $newId = (int)$db->lastInsertId();

        $stmt = $db->prepare("SELECT * FROM currencies WHERE id = ?");
        $stmt->execute([$newId]);
        Response::success($stmt->fetch(), 201);
    }

    if ($method === 'PUT') {
        if (!$isSiteAdmin) { Response::error('Admin access required.', 403); }
        if (!$id) { Response::error('Currency ID is required.', 400); }

        $stmt = $db->prepare("SELECT * FROM currencies WHERE id = ?");
        $stmt->execute([$id]);
        if (!$stmt->fetch()) { Response::error('Currency not found.', 404); }

        $body = Response::getBody();
        $fields = [];
        $params = [];

        if (isset($body['name'])) { $fields[] = 'name = ?'; $params[] = Response::sanitize($body['name']); }
        if (isset($body['code'])) { $fields[] = 'code = ?'; $params[] = Response::sanitize($body['code']); }
        if (isset($body['symbol'])) { $fields[] = 'symbol = ?'; $params[] = Response::sanitize($body['symbol']); }
        if (isset($body['exchange_rate_to_base'])) { $fields[] = 'exchange_rate_to_base = ?'; $params[] = (float)$body['exchange_rate_to_base']; }
        if (array_key_exists('is_active', $body)) { $fields[] = 'is_active = ?'; $params[] = (int)(bool)$body['is_active']; }

        if (empty($fields)) { Response::error('No fields to update.', 400); }

        $params[] = $id;
        $stmt = $db->prepare("UPDATE currencies SET " . implode(', ', $fields) . " WHERE id = ?");
        $stmt->execute($params);

        $stmt = $db->prepare("SELECT * FROM currencies WHERE id = ?");
        $stmt->execute([$id]);
        Response::success($stmt->fetch());
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

    $result = ExchangeRates::refresh($db);

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

        $stmt = $db->prepare(
            'SELECT c.code, crh.rate_to_base, crh.base_currency
             FROM currency_rate_history crh
             JOIN currencies c ON crh.currency_id = c.id
             WHERE crh.recorded_at = ?'
        );
        $stmt->execute([$date]);
        $rows = $stmt->fetchAll();

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
// CONFIG — Expose server configuration to client
// ============================================================================
if ($resource === 'config') {
    if ($method === 'GET') {
        require_once __DIR__ . '/../core/Storage.php';
        $systemSettings = Storage::adapter()->getSystemSettings();
        Response::success(array_merge(
            ['base_currency' => BASE_CURRENCY],
            $systemSettings
        ));
    }
    Response::error('Method not allowed.', 405);
}

Response::error('Invalid resource.', 404);
