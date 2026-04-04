/**
 * portfolioAggregator.js — Pure function module for client-side portfolio aggregation.
 * No React dependencies. Uses portfolio_role markers from template fields.
 */

/**
 * Extract the monetary value from decrypted entry data using template field markers.
 * Strategy:
 *   1. Look for portfolio_role: 'value' → direct value
 *   2. Look for portfolio_role: 'quantity' × portfolio_role: 'price' → computed
 *   3. Fallback: value || current_value || face_value fields
 */
export function extractValue(decryptedData, templateFields) {
  if (!decryptedData || !templateFields) return 0;

  let valueField = null;
  let quantityField = null;
  let priceField = null;

  for (const field of templateFields) {
    if (field.portfolio_role === 'value') valueField = field;
    else if (field.portfolio_role === 'quantity') quantityField = field;
    else if (field.portfolio_role === 'price') priceField = field;
  }

  // Strategy 1: direct value field
  if (valueField) {
    const v = parseFloat(decryptedData[valueField.key]);
    return isNaN(v) ? 0 : v;
  }

  // Strategy 2: quantity × price
  if (quantityField && priceField) {
    const qty = parseFloat(decryptedData[quantityField.key]);
    const price = parseFloat(decryptedData[priceField.key]);
    if (!isNaN(qty) && !isNaN(price)) return qty * price;
  }

  // Strategy 3: fallback for templates without portfolio_role markers
  for (const key of ['value', 'current_value', 'face_value']) {
    const v = parseFloat(decryptedData[key]);
    if (!isNaN(v)) return v;
  }

  return 0;
}

/**
 * Extract gain/loss data from a decrypted entry.
 * Only returns values when both cost_price and current price are populated.
 *
 * @returns {{ costPrice, currentPrice, quantity, gainLoss, gainLossPercent } | null}
 */
export function extractGainLoss(decryptedData, templateFields) {
  if (!decryptedData || !templateFields) return null;

  const costPrice = parseFloat(decryptedData.cost_price);
  if (isNaN(costPrice) || costPrice === 0) return null;

  let currentPrice = null;
  let quantity = null;

  for (const field of templateFields) {
    if (field.portfolio_role === 'price') {
      currentPrice = parseFloat(decryptedData[field.key]);
    }
    if (field.portfolio_role === 'quantity') {
      quantity = parseFloat(decryptedData[field.key]);
    }
  }

  if (currentPrice === null || isNaN(currentPrice)) return null;
  if (quantity === null || isNaN(quantity)) quantity = 1;

  const gainLoss = (currentPrice - costPrice) * quantity;
  const gainLossPercent = costPrice !== 0 ? ((currentPrice - costPrice) / costPrice) * 100 : 0;

  return { costPrice, currentPrice, quantity, gainLoss, gainLossPercent };
}

/**
 * Build a lookup map of currency code → exchange_rate_to_base.
 */
export function buildRateMap(currencies) {
  const map = {};
  for (const c of currencies) {
    map[c.code] = parseFloat(c.exchange_rate_to_base) || 0;
  }
  return map;
}

/**
 * Convert an amount from one currency to another via base currency triangulation.
 * Rates are stored as "X → base" (e.g., USD → GBP = 0.79).
 * Conversion: amount_in_from × rateMap[from] / rateMap[to]
 */
export function convertCurrency(amount, fromCode, toCode, rateMap) {
  if (!fromCode || !toCode || fromCode === toCode) return amount;
  const fromRate = rateMap[fromCode];
  const toRate = rateMap[toCode];
  if (!fromRate || !toRate) return amount; // can't convert, return as-is
  return amount * fromRate / toRate;
}

/**
 * Build a symbol lookup map from currencies array.
 */
export function buildSymbolMap(currencies) {
  const map = {};
  for (const c of currencies) {
    map[c.code] = c.symbol || c.code;
  }
  return map;
}

/**
 * Internal helper: initialize a group bucket if needed, accumulate total + count.
 * Returns the group object so callers can append extra fields (items, has_liability, etc.).
 */
function accumulateGroup(groups, key, value, defaults) {
  if (!groups[key]) groups[key] = { total: 0, count: 0, ...defaults };
  groups[key].total += value;
  groups[key].count++;
  return groups[key];
}

/**
 * Recalculate a snapshot from its per-entry blobs using a given rate map.
 * Used by HistoryTab to recompute totals at snapshot-time or current rates.
 *
 * @param {Array} entries - Decrypted snapshot entry blobs [{name, template_name, subtype, is_liability, currency, raw_value, icon}]
 * @param {object} rateMap - Currency code → rate_to_base map
 * @param {string} displayCurrency - User's display currency
 * @returns {object} { total_assets, total_liabilities, net_worth, asset_count, by_type, by_currency, by_country, by_account, entries }
 */
export function recalculateSnapshot(entries, rateMap, displayCurrency) {
  let totalAssets = 0;
  let totalLiabilities = 0;
  let assetCount = 0;
  const byType = {};
  const byCurrency = {};
  const byCountry = {};
  const byAccount = {};
  const enrichedEntries = [];

  for (const e of entries) {
    if (!e || e.raw_value === undefined || Number.isNaN(e.raw_value)) continue;
    // Skip zero-value non-liability entries (match aggregatePortfolio)
    if (e.raw_value === 0 && !e.is_liability) continue;

    const currency = e.currency || displayCurrency;
    const displayValue = convertCurrency(e.raw_value, currency, displayCurrency, rateMap);

    assetCount++;

    if (e.is_liability) {
      totalLiabilities += Math.abs(displayValue);
    } else {
      totalAssets += displayValue;
    }

    // Group by type — normalize to lowercase (old snapshots may have capitalized keys)
    const typeKey = (e.subtype || e.entry_type || e.template_name || 'other').toLowerCase();
    accumulateGroup(byType, typeKey, displayValue, { label: e.template_name || typeKey });

    // Group by currency
    accumulateGroup(byCurrency, currency, displayValue, { label: currency });

    // Group by country
    const countryKey = e.country || 'Unknown';
    accumulateGroup(byCountry, countryKey, displayValue, { label: countryKey });

    // Group by linked account
    const acctId = e.linked_account?.id;
    const acctKey = acctId ? String(acctId) : '_unlinked';
    accumulateGroup(byAccount, acctKey, displayValue, { label: e.linked_account?.name || 'Not linked to an account' });

    enrichedEntries.push({ ...e, displayValue });
  }

  return {
    total_assets: totalAssets,
    total_liabilities: totalLiabilities,
    net_worth: totalAssets - totalLiabilities,
    asset_count: assetCount,
    by_type: byType,
    by_currency: byCurrency,
    by_country: byCountry,
    by_account: byAccount,
    entries: enrichedEntries,
  };
}

/**
 * Main aggregation function. Returns structured portfolio data.
 *
 * @param {Array} entries - Decrypted vault entries [{id, entry_type, decrypted, template}]
 * @param {Array} currencies - Currencies from reference data
 * @param {string} baseCurrency - Server base currency code (e.g., 'GBP')
 * @param {string} displayCurrency - User's chosen display currency
 * @returns {object} Aggregated portfolio
 */
export function aggregatePortfolio(entries, currencies, baseCurrency, displayCurrency) {
  const rateMap = buildRateMap(currencies);
  const symbolMap = buildSymbolMap(currencies);
  const targetCurrency = displayCurrency || baseCurrency;

  let totalAssets = 0;
  let totalLiabilities = 0;
  let totalGainLoss = 0;
  let assetCount = 0;

  const assets = [];
  const byCountry = {};
  const byType = {};
  const byAccount = {};
  const byCurrency = {};
  const byTicker = {};

  // First pass: identify accounts (containers)
  const accountMap = {};
  for (const entry of entries) {
    if (entry.entry_type === 'account' && entry.decrypted) {
      accountMap[entry.id] = {
        id: entry.id,
        name: entry.decrypted.title || 'Untitled Account',
        institution: entry.decrypted.institution || entry.decrypted.provider || '',
        currency: entry.decrypted.currency || baseCurrency,
        subtype: entry.template?.subtype || null,
        icon: entry.template?.icon || 'bank',
      };
    }
  }

  // Second pass: process all asset/account entries
  for (const entry of entries) {
    if (!entry.decrypted) continue;
    const d = entry.decrypted;
    const template = entry.template;
    const templateFields = template?.fields || [];
    const isLiability = template?.is_liability || false;
    const entryType = entry.entry_type;
    const subtype = template?.subtype || null;

    // Accounts are containers — skip value aggregation (DC1)
    if (entryType === 'account') continue;

    // Only aggregate asset entries
    if (entryType !== 'asset') continue;

    const rawValue = extractValue(d, templateFields);
    if (rawValue === 0 && !isLiability) continue; // Skip zero-value non-liability entries

    const currency = d.currency || baseCurrency;
    const country = d.country || null;
    const linkedAccountId = d.linked_account_id || null;

    // Apply liability negation
    const signedValue = isLiability ? -Math.abs(rawValue) : rawValue;

    // Convert to display currency
    const displayValue = convertCurrency(signedValue, currency, targetCurrency, rateMap);
    // Convert to base currency for internal totals
    const baseValue = convertCurrency(signedValue, currency, baseCurrency, rateMap);

    // Extract quantity/price fields for ticker view
    let shares = null;
    let pricePerShare = null;
    for (const field of templateFields) {
      if (field.portfolio_role === 'quantity') shares = parseFloat(d[field.key]) || null;
      if (field.portfolio_role === 'price') pricePerShare = parseFloat(d[field.key]) || null;
    }

    const assetItem = {
      id: entry.id,
      name: d.title || 'Untitled',
      entry_type: entryType,
      subtype,
      currency,
      rawValue: signedValue,
      baseValue,
      displayValue,
      is_liability: isLiability,
      country,
      linked_account_id: linkedAccountId,
      icon: template?.icon || 'circle',
      template_name: template?.name || entryType,
      integrations: d.integrations || null,
      ticker: d.ticker || null,
      shares,
      pricePerShare,
    };

    // Add gain/loss if cost_price is available
    const gainLossData = extractGainLoss(d, templateFields);
    if (gainLossData) {
      assetItem.gainLoss = gainLossData.gainLoss;
      assetItem.gainLossPercent = gainLossData.gainLossPercent;
      assetItem.costPrice = gainLossData.costPrice;
      const glBase = convertCurrency(gainLossData.gainLoss, currency, baseCurrency, rateMap);
      totalGainLoss += glBase;
    }

    assets.push(assetItem);
    assetCount++;

    if (isLiability) {
      totalLiabilities += Math.abs(baseValue);
    } else {
      totalAssets += baseValue;
    }

    // Group by country
    const countryKey = country || 'Unknown';
    accumulateGroup(byCountry, countryKey, displayValue, { items: [] }).items.push(assetItem);

    // Group by type (subtype or entry_type)
    const typeKey = subtype || entryType;
    const typeGroup = accumulateGroup(byType, typeKey, displayValue, { items: [], has_liability: false, label: template?.name || typeKey });
    typeGroup.items.push(assetItem);
    if (isLiability) typeGroup.has_liability = true;

    // Group by linked account
    const acctKey = linkedAccountId || '_unlinked';
    const acct = accountMap[linkedAccountId];
    accumulateGroup(byAccount, acctKey, displayValue, { items: [], account: acct || null, label: acct ? acct.name : 'Not linked to an account' }).items.push(assetItem);

    // Group by currency
    accumulateGroup(byCurrency, currency, displayValue, { symbol: symbolMap[currency] || currency });

    // Group by ticker
    if (d.ticker) {
      const tickerKey = d.ticker.toUpperCase();
      const tg = accumulateGroup(byTicker, tickerKey, displayValue, {
        items: [], label: tickerKey, totalShares: 0, totalCost: 0, costCount: 0,
      });
      tg.items.push(assetItem);
      if (shares) tg.totalShares += shares;
      if (assetItem.costPrice && shares) {
        tg.totalCost += assetItem.costPrice * shares;
        tg.costCount += shares;
      }
    } else {
      const otherGroup = accumulateGroup(byTicker, '_other', displayValue, {
        items: [], label: 'Other Assets', totalShares: 0, totalCost: 0, costCount: 0,
      });
      otherGroup.items.push(assetItem);
    }
  }

  // Find rates_last_updated from currencies
  let ratesLastUpdated = null;
  for (const c of currencies) {
    if (c.last_updated) {
      if (!ratesLastUpdated || c.last_updated > ratesLastUpdated) {
        ratesLastUpdated = c.last_updated;
      }
    }
  }

  // Convert totals to display currency
  const totalAssetsDisplay = convertCurrency(totalAssets, baseCurrency, targetCurrency, rateMap);
  const totalLiabilitiesDisplay = convertCurrency(totalLiabilities, baseCurrency, targetCurrency, rateMap);

  return {
    summary: {
      total_assets: totalAssetsDisplay,
      total_liabilities: totalLiabilitiesDisplay,
      net_worth: totalAssetsDisplay - totalLiabilitiesDisplay,
      asset_count: assetCount,
      total_gain_loss: convertCurrency(totalGainLoss, baseCurrency, targetCurrency, rateMap),
    },
    assets,
    by_country: byCountry,
    by_type: byType,
    by_account: byAccount,
    by_currency: byCurrency,
    by_ticker: byTicker,
    rates_last_updated: ratesLastUpdated,
    accounts: accountMap,
  };
}
