<?php
/**
 * Personal Vault V2 — Portfolio Helper
 * Shared functions used by portfolio.php and sharing.php.
 */

/**
 * Aggregate portfolio from the assets table.
 * Returns totals, breakdowns by country/type/account, and the full assets list.
 */
function aggregatePortfolio(PDO $db, int $userId, string $dek): array {
    $sql = "SELECT a.id, a.user_id, a.account_id, a.asset_type_id, a.name, a.currency_id,
                   a.amount, a.is_liquid, a.is_liability, a.asset_data, a.comments,
                   at.name AS asset_type_name, at.category AS asset_type_category, at.icon AS asset_type_icon,
                   cur.code AS currency_code, cur.symbol AS currency_symbol, cur.exchange_rate_to_base,
                   acc.name AS account_name_enc,
                   c.name AS country_name, c.code AS country_code, c.flag_emoji
            FROM assets a
            LEFT JOIN asset_types at ON a.asset_type_id = at.id
            LEFT JOIN currencies cur ON a.currency_id = cur.id
            LEFT JOIN accounts acc ON a.account_id = acc.id
            LEFT JOIN countries c ON a.country_id = c.id
            WHERE a.user_id = ? AND a.is_active = 1
            ORDER BY a.id ASC";

    $stmt = $db->prepare($sql);
    $stmt->execute([$userId]);
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

    // Decrypt fields
    foreach ($rows as &$row) {
        $row['name'] = Encryption::decrypt($row['name'], $dek) ?? $row['name'];
        $row['amount'] = Encryption::decrypt($row['amount'], $dek);
        $row['comments'] = Encryption::decrypt($row['comments'], $dek);
        $dataDecrypted = Encryption::decrypt($row['asset_data'], $dek);
        $row['asset_data'] = $dataDecrypted !== null ? json_decode($dataDecrypted, true) : null;
        if ($row['account_name_enc']) {
            $row['account_name'] = Encryption::decrypt($row['account_name_enc'], $dek);
        } else {
            $row['account_name'] = null;
        }
        unset($row['account_name_enc']);
    }
    unset($row);

    // Compute totals
    $totalAssets = 0.0;
    $totalLiquid = 0.0;
    $totalLiabilities = 0.0;

    foreach ($rows as &$row) {
        $amount = (float)($row['amount'] ?? 0);
        $rate = (float)($row['exchange_rate_to_base'] ?? 1);
        $baseAmount = $amount * $rate;
        $row['base_amount'] = round($baseAmount, 2);

        if ((bool)$row['is_liability']) {
            $totalLiabilities += abs($baseAmount);
        } else {
            $totalAssets += $baseAmount;
            if ((bool)$row['is_liquid']) {
                $totalLiquid += $baseAmount;
            }
        }
    }
    unset($row);

    $netWorth = $totalAssets - $totalLiabilities;

    // Group by country
    $byCountry = [];
    foreach ($rows as $row) {
        $countryName = $row['country_name'] ?? 'Standalone';
        $countryCode = $row['country_code'] ?? 'XX';
        $isLiability = (bool)$row['is_liability'];
        $baseAmt = $row['base_amount'];

        if (!isset($byCountry[$countryCode])) {
            $byCountry[$countryCode] = [
                'country_name' => $countryName,
                'country_code' => $countryCode,
                'flag_emoji'   => $row['flag_emoji'],
                'total'        => 0.0,
                'assets'       => 0.0,
                'liabilities'  => 0.0,
                'count'        => 0,
            ];
        }
        $byCountry[$countryCode]['count']++;
        if ($isLiability) {
            $byCountry[$countryCode]['liabilities'] += abs($baseAmt);
        } else {
            $byCountry[$countryCode]['assets'] += $baseAmt;
        }
        $byCountry[$countryCode]['total'] = $byCountry[$countryCode]['assets'] - $byCountry[$countryCode]['liabilities'];
    }

    // Group by asset type category
    $byType = [];
    foreach ($rows as $row) {
        $typeName = $row['asset_type_name'] ?? 'Unknown';
        $isLiability = (bool)$row['is_liability'];
        $baseAmt = $row['base_amount'];

        if (!isset($byType[$typeName])) {
            $byType[$typeName] = [
                'type_name'    => $typeName,
                'category'     => $row['asset_type_category'] ?? 'other',
                'is_liability' => $isLiability,
                'total'        => 0.0,
                'count'        => 0,
            ];
        }
        $byType[$typeName]['count']++;
        $byType[$typeName]['total'] += $isLiability ? -abs($baseAmt) : $baseAmt;
    }

    // Group by account
    $byAccount = [];
    foreach ($rows as $row) {
        $accountId = $row['account_id'] ? (int)$row['account_id'] : 0;
        $accountName = $row['account_name'] ?? 'Standalone';
        $isLiability = (bool)$row['is_liability'];
        $baseAmt = $row['base_amount'];

        if (!isset($byAccount[$accountId])) {
            $byAccount[$accountId] = [
                'account_id'   => $accountId ?: null,
                'account_name' => $accountName,
                'total'        => 0.0,
                'assets'       => 0.0,
                'liabilities'  => 0.0,
                'count'        => 0,
            ];
        }
        $byAccount[$accountId]['count']++;
        if ($isLiability) {
            $byAccount[$accountId]['liabilities'] += abs($baseAmt);
        } else {
            $byAccount[$accountId]['assets'] += $baseAmt;
        }
        $byAccount[$accountId]['total'] = $byAccount[$accountId]['assets'] - $byAccount[$accountId]['liabilities'];
    }

    $byCountry = array_values($byCountry);
    $byType = array_values($byType);
    $byAccount = array_values($byAccount);

    // Build assets list for output
    $assetsList = [];
    foreach ($rows as $row) {
        $assetsList[] = [
            'id'                    => (int)$row['id'],
            'user_id'               => (int)$row['user_id'],
            'account_id'            => $row['account_id'] ? (int)$row['account_id'] : null,
            'account_name'          => $row['account_name'],
            'asset_type_id'         => (int)$row['asset_type_id'],
            'asset_type_name'       => $row['asset_type_name'],
            'asset_type_category'   => $row['asset_type_category'],
            'name'                  => $row['name'],
            'currency_id'           => (int)$row['currency_id'],
            'currency_code'         => $row['currency_code'],
            'currency_symbol'       => $row['currency_symbol'],
            'amount'                => $row['amount'],
            'exchange_rate_to_base' => (float)$row['exchange_rate_to_base'],
            'base_amount'           => $row['base_amount'],
            'is_liquid'             => (bool)$row['is_liquid'],
            'is_liability'          => (bool)$row['is_liability'],
            'country_name'          => $row['country_name'],
            'country_code'          => $row['country_code'],
            'flag_emoji'            => $row['flag_emoji'],
            'asset_data'            => $row['asset_data'],
        ];
    }

    return [
        'totalAssets'      => round($totalAssets, 2),
        'totalLiquid'      => round($totalLiquid, 2),
        'totalLiabilities' => round($totalLiabilities, 2),
        'netWorth'         => round($netWorth, 2),
        'by_country'       => $byCountry,
        'by_type'          => $byType,
        'by_account'       => $byAccount,
        'assets'           => $assetsList,
    ];
}
