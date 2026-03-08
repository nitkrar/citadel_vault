<?php
/**
 * Personal Vault V2 — CSV Export API
 * Exports portfolio, assets, accounts, insurance, licenses, vault titles, and exchange rates.
 */
require_once __DIR__ . '/../core/Response.php';
require_once __DIR__ . '/../../config/config.php';
require_once __DIR__ . '/../core/Auth.php';
require_once __DIR__ . '/../core/Encryption.php';

Response::setCors();
$payload = Auth::requireAuth();
$dek = Encryption::requireDek();
$userId = $payload['sub'];
$db = Database::getInstance();

$format   = strtolower(trim($_GET['format'] ?? 'csv'));
$sections = array_filter(array_map('trim', explode(',', $_GET['sections'] ?? '')));
$snapshot = trim($_GET['snapshot'] ?? '');

if ($format !== 'csv') Response::error('Unsupported format. Only "csv" is supported.', 400);
if (empty($sections)) Response::error('At least one section is required.', 400);

$validSections = ['portfolio', 'assets', 'accounts', 'insurance', 'by_country', 'by_type', 'licenses', 'vault', 'rates'];
foreach ($sections as $s) {
    if (!in_array($s, $validSections, true)) Response::error("Invalid section: $s", 400);
}

// Aggregate portfolio from assets
function aggregatePortfolioOffline(PDO $db, int $userId, string $dek): array {
    $sql = "SELECT a.id, a.name, a.amount, a.is_liquid, a.is_liability,
                   a.asset_data, a.account_id,
                   at.name AS type_name, at.category,
                   cur.code AS currency_code, cur.symbol AS currency_symbol, cur.exchange_rate_to_base,
                   acc.country_id,
                   c.name AS country_name, c.code AS country_code, c.flag_emoji
            FROM assets a
            LEFT JOIN asset_types at ON a.asset_type_id = at.id
            LEFT JOIN currencies cur ON a.currency_id = cur.id
            LEFT JOIN accounts acc ON a.account_id = acc.id
            LEFT JOIN countries c ON acc.country_id = c.id
            WHERE a.user_id = ? AND a.is_active = 1
            ORDER BY a.id ASC";
    $stmt = $db->prepare($sql);
    $stmt->execute([$userId]);
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

    foreach ($rows as &$row) {
        $row['name']   = Encryption::decrypt($row['name'], $dek) ?? $row['name'];
        $row['amount'] = Encryption::decrypt($row['amount'], $dek);
    }
    unset($row);

    $totalAssets = 0.0; $totalLiquid = 0.0; $totalLiabilities = 0.0;
    $byCountry = []; $byType = [];
    foreach ($rows as &$row) {
        $amount = (float)($row['amount'] ?? 0);
        $rate = (float)($row['exchange_rate_to_base'] ?? 1);
        $baseAmount = $amount * $rate;
        $row['base_amount'] = round($baseAmount, 2);
        $isLiability = (bool)($row['is_liability'] ?? false);

        if ($isLiability) { $totalLiabilities += abs($baseAmount); }
        else { $totalAssets += $baseAmount; if ($row['is_liquid']) $totalLiquid += $baseAmount; }

        $cc = $row['country_code'] ?? 'XX';
        if (!isset($byCountry[$cc])) $byCountry[$cc] = ['country_name' => $row['country_name'] ?? 'Standalone', 'total' => 0.0, 'liquid' => 0.0, 'count' => 0];
        $byCountry[$cc]['count']++;
        $byCountry[$cc]['total'] += $isLiability ? -abs($baseAmount) : $baseAmount;
        if ($row['is_liquid'] && !$isLiability) $byCountry[$cc]['liquid'] += $baseAmount;

        $tn = $row['type_name'] ?? 'Unknown';
        if (!isset($byType[$tn])) $byType[$tn] = ['total' => 0.0, 'liquid' => 0.0, 'count' => 0];
        $byType[$tn]['count']++;
        $byType[$tn]['total'] += $isLiability ? -abs($baseAmount) : $baseAmount;
        if ($row['is_liquid'] && !$isLiability) $byType[$tn]['liquid'] += $baseAmount;
    }
    unset($row);

    return [
        'totalAssets' => round($totalAssets, 2), 'totalLiquid' => round($totalLiquid, 2),
        'totalLiabilities' => round($totalLiabilities, 2), 'netWorth' => round($totalAssets - $totalLiabilities, 2),
        'assets' => $rows, 'by_country' => $byCountry, 'by_type' => $byType,
    ];
}

// Load data: snapshot or live
$portfolioData = null;
$snapshotDate = null;

if ($snapshot !== '') {
    if ($snapshot === 'latest') {
        $stmt = $db->prepare("SELECT * FROM portfolio_snapshots WHERE user_id = ? ORDER BY snapshot_date DESC LIMIT 1");
        $stmt->execute([$userId]);
    } else {
        $parsed = date_create_from_format('Y-m-d', $snapshot);
        if (!$parsed || $parsed->format('Y-m-d') !== $snapshot) Response::error('Invalid snapshot date.', 400);
        $stmt = $db->prepare("SELECT * FROM portfolio_snapshots WHERE user_id = ? AND snapshot_date = ?");
        $stmt->execute([$userId, $snapshot]);
    }
    $snap = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$snap) Response::error('Snapshot not found.', 404);
    $snapshotDate = $snap['snapshot_date'];
    $details = null;
    if ($snap['details_json']) {
        $decrypted = Encryption::decrypt($snap['details_json'], $dek);
        if ($decrypted) $details = json_decode($decrypted, true);
    }
    $portfolioData = [
        'totalAssets' => (float)$snap['total_assets'], 'totalLiquid' => (float)$snap['total_liquid'],
        'totalLiabilities' => (float)$snap['total_liabilities'], 'netWorth' => (float)$snap['net_worth'],
        'assets' => [], 'by_country' => $details['by_country'] ?? [], 'by_type' => $details['by_type'] ?? [],
    ];
} else {
    $portfolioData = aggregatePortfolioOffline($db, $userId, $dek);
}

// Build CSV output
$filename = 'citadel_export_' . date('Y-m-d_His') . '.csv';
header('Content-Type: text/csv; charset=utf-8');
header('Content-Disposition: attachment; filename="' . $filename . '"');
$out = fopen('php://output', 'w');
fwrite($out, "\xEF\xBB\xBF"); // UTF-8 BOM for Excel

$dateLine = $snapshotDate ? "Snapshot: $snapshotDate" : 'Live Data: ' . date('Y-m-d H:i:s');
fputcsv($out, ['Personal Vault Export', $dateLine]);
fputcsv($out, []);

if (in_array('portfolio', $sections, true)) {
    fputcsv($out, ['--- PORTFOLIO SUMMARY ---']);
    fputcsv($out, ['Metric', 'Value']);
    fputcsv($out, ['Net Worth', $portfolioData['netWorth']]);
    fputcsv($out, ['Total Assets', $portfolioData['totalAssets']]);
    fputcsv($out, ['Liquid Assets', $portfolioData['totalLiquid']]);
    fputcsv($out, ['Total Liabilities', $portfolioData['totalLiabilities']]);
    fputcsv($out, ['Base Currency', BASE_CURRENCY]);
    fputcsv($out, []);
}

if (in_array('assets', $sections, true) && !empty($portfolioData['assets'])) {
    fputcsv($out, ['--- ASSETS ---']);
    fputcsv($out, ['Name', 'Type', 'Currency', 'Amount', 'Base Amount', 'Liquid', 'Liability', 'Country']);
    foreach ($portfolioData['assets'] as $a) {
        fputcsv($out, [
            $a['name'] ?? '', $a['type_name'] ?? '', $a['currency_code'] ?? '',
            $a['amount'] ?? '', $a['base_amount'] ?? '',
            ($a['is_liquid'] ?? false) ? 'Yes' : 'No',
            ($a['is_liability'] ?? false) ? 'Yes' : 'No',
            ($a['country_name'] ?? 'Standalone') . ' (' . ($a['country_code'] ?? 'XX') . ')'
        ]);
    }
    fputcsv($out, []);
}

if (in_array('accounts', $sections, true)) {
    fputcsv($out, ['--- ACCOUNTS ---']);
    fputcsv($out, ['Name', 'Institution', 'Type', 'Subtype', 'Country', 'Currency']);
    $accStmt = $db->prepare(
        "SELECT a.name, a.institution, a.subtype,
                at.name AS type_name,
                c.name AS country_name, c.code AS country_code,
                cur.code AS currency_code
         FROM accounts a
         LEFT JOIN account_types at ON a.account_type_id = at.id
         LEFT JOIN countries c ON a.country_id = c.id
         LEFT JOIN currencies cur ON a.currency_id = cur.id
         WHERE a.user_id = ? AND a.is_active = 1 ORDER BY a.name"
    );
    $accStmt->execute([$userId]);
    foreach ($accStmt->fetchAll(PDO::FETCH_ASSOC) as $acc) {
        fputcsv($out, [
            Encryption::decrypt($acc['name'], $dek) ?? '',
            Encryption::decrypt($acc['institution'], $dek) ?? '',
            $acc['type_name'] ?? '',
            $acc['subtype'] ?? '',
            ($acc['country_name'] ?? '') . ' (' . ($acc['country_code'] ?? '') . ')',
            $acc['currency_code'] ?? ''
        ]);
    }
    fputcsv($out, []);
}

if (in_array('insurance', $sections, true)) {
    fputcsv($out, ['--- INSURANCE POLICIES ---']);
    fputcsv($out, ['Policy Name', 'Provider', 'Category', 'Start Date', 'Maturity Date', 'Frequency', 'Premium', 'Coverage']);
    $insStmt = $db->prepare("SELECT * FROM insurance_policies WHERE user_id = ? AND is_active = 1 ORDER BY policy_name");
    $insStmt->execute([$userId]);
    foreach ($insStmt->fetchAll(PDO::FETCH_ASSOC) as $ins) {
        fputcsv($out, [
            Encryption::decrypt($ins['policy_name'], $dek) ?? '',
            Encryption::decrypt($ins['provider'], $dek) ?? '',
            $ins['category'] ?? '',
            $ins['start_date'] ?? '',
            $ins['maturity_date'] ?? '',
            $ins['payment_frequency'] ?? '',
            Encryption::decrypt($ins['premium_amount'], $dek) ?? '',
            Encryption::decrypt($ins['coverage_amount'], $dek) ?? ''
        ]);
    }
    fputcsv($out, []);
}

if (in_array('by_country', $sections, true)) {
    fputcsv($out, ['--- BY COUNTRY ---']);
    fputcsv($out, ['Country', 'Total (Base)', 'Liquid (Base)', 'Assets']);
    $bc = $portfolioData['by_country'];
    foreach ($bc as $key => $c) {
        $name = $c['country_name'] ?? (is_string($key) ? $key : '');
        $liquid = $c['liquid'] ?? 0;
        fputcsv($out, [$name, round($c['total'] ?? 0, 2), round($liquid, 2), $c['count'] ?? '']);
    }
    fputcsv($out, []);
}

if (in_array('by_type', $sections, true)) {
    fputcsv($out, ['--- BY TYPE ---']);
    fputcsv($out, ['Type', 'Total (Base)', 'Liquid (Base)', 'Count']);
    foreach ($portfolioData['by_type'] as $key => $t) {
        $name = $t['type_name'] ?? (is_string($key) ? $key : '');
        fputcsv($out, [$name, round($t['total'] ?? 0, 2), round($t['liquid'] ?? 0, 2), $t['count'] ?? '']);
    }
    fputcsv($out, []);
}

if (in_array('licenses', $sections, true)) {
    fputcsv($out, ['--- LICENSES ---']);
    fputcsv($out, ['Product', 'Vendor', 'Category', 'Purchase Date', 'Expiry Date', 'Seats']);
    $licStmt = $db->prepare("SELECT * FROM licenses WHERE user_id = ? ORDER BY product_name ASC");
    $licStmt->execute([$userId]);
    foreach ($licStmt->fetchAll(PDO::FETCH_ASSOC) as $lic) {
        fputcsv($out, [
            Encryption::decrypt($lic['product_name'], $dek) ?? '',
            Encryption::decrypt($lic['vendor'], $dek) ?? '',
            $lic['category'] ?? '', $lic['purchase_date'] ?? '', $lic['expiry_date'] ?? '', $lic['seats'] ?? ''
        ]);
    }
    fputcsv($out, []);
}

if (in_array('vault', $sections, true)) {
    fputcsv($out, ['--- VAULT ENTRIES (Titles Only) ---']);
    fputcsv($out, ['Title', 'Website', 'Category']);
    $vaultStmt = $db->prepare("SELECT * FROM password_vault WHERE user_id = ? ORDER BY title ASC");
    $vaultStmt->execute([$userId]);
    foreach ($vaultStmt->fetchAll(PDO::FETCH_ASSOC) as $v) {
        fputcsv($out, [
            Encryption::decrypt($v['title'], $dek) ?? '',
            Encryption::decrypt($v['website_url'], $dek) ?? '',
            $v['category'] ?? ''
        ]);
    }
    fputcsv($out, []);
}

if (in_array('rates', $sections, true)) {
    fputcsv($out, ['--- EXCHANGE RATES ---']);
    fputcsv($out, ['Currency', 'Code', 'Symbol', 'Rate to ' . BASE_CURRENCY]);
    $rateStmt = $db->prepare("SELECT name, code, symbol, exchange_rate_to_base FROM currencies ORDER BY display_order ASC, name ASC");
    $rateStmt->execute();
    foreach ($rateStmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
        fputcsv($out, [$r['name'], $r['code'], $r['symbol'], $r['exchange_rate_to_base']]);
    }
    fputcsv($out, []);
}

fclose($out);
exit;
