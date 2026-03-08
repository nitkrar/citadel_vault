/**
 * importResolvers.js — Maps text values from imported files to reference data IDs.
 *
 * Supports matching by: name, code, ID, and common aliases.
 */

/**
 * Resolve a text value to a reference data ID.
 * Returns the matched ID or null.
 *
 * @param {string} value - The text value from the import file
 * @param {Array} refItems - The reference data items (each must have .id)
 * @param {object} opts - Options: { displayKey, codeFn }
 */
function resolveToId(value, refItems, opts = {}) {
  if (!value || !refItems || refItems.length === 0) return null;
  const v = String(value).trim().toLowerCase();
  if (!v) return null;

  // Try exact ID match
  const asNum = parseInt(v, 10);
  if (!isNaN(asNum)) {
    const byId = refItems.find((item) => item.id === asNum);
    if (byId) return byId.id;
  }

  // Try name match
  const displayKey = opts.displayKey || 'name';
  const byName = refItems.find(
    (item) => (item[displayKey] || '').trim().toLowerCase() === v
  );
  if (byName) return byName.id;

  // Try code match (for currencies, countries)
  if (opts.codeKey) {
    const byCode = refItems.find(
      (item) => (item[opts.codeKey] || '').trim().toLowerCase() === v
    );
    if (byCode) return byCode.id;
  }

  // Try partial match
  const byPartial = refItems.find(
    (item) => (item[displayKey] || '').trim().toLowerCase().includes(v)
  );
  if (byPartial) return byPartial.id;

  return null;
}

/**
 * Build a resolver map for a given entity type and reference data.
 *
 * Returns an object where each key is a field key and the value is a resolver function.
 */
export function buildResolvers(entityType, referenceData) {
  const resolvers = {};

  const currencyResolver = (value) => {
    return resolveToId(value, referenceData.currencies || [], {
      displayKey: 'name',
      codeKey: 'code',
    });
  };

  const countryResolver = (value) => {
    return resolveToId(value, referenceData.countries || [], {
      displayKey: 'name',
      codeKey: 'code',
    });
  };

  const boolResolver = (value) => {
    if (!value) return false;
    const v = String(value).trim().toLowerCase();
    return ['true', '1', 'yes', 'y'].includes(v);
  };

  switch (entityType) {
    case 'assets':
      resolvers.asset_type_id = (value) =>
        resolveToId(value, referenceData.assetTypes || [], { displayKey: 'name' });
      resolvers.account_id = (value) =>
        resolveToId(value, referenceData.accounts || [], { displayKey: 'name' });
      resolvers.currency_id = currencyResolver;
      resolvers.country_id = countryResolver;
      resolvers.is_liquid = boolResolver;
      resolvers.is_liability = boolResolver;
      break;

    case 'accounts':
      resolvers.account_type_id = (value) =>
        resolveToId(value, referenceData.accountTypes || [], { displayKey: 'name' });
      resolvers.currency_id = currencyResolver;
      resolvers.country_id = countryResolver;
      break;

    case 'vault':
      resolvers.is_favourite = boolResolver;
      break;

    case 'licenses':
      // No special resolvers needed — all text fields
      break;

    case 'insurance':
      // Category has fixed options
      resolvers.category = (value) => {
        if (!value) return null;
        const v = String(value).trim();
        const options = ['Life', 'Health', 'Vehicle', 'Property', 'Other'];
        const match = options.find((o) => o.toLowerCase() === v.toLowerCase());
        return match || v;
      };
      resolvers.payment_frequency = (value) => {
        if (!value) return null;
        const v = String(value).trim();
        const options = ['Monthly', 'Quarterly', 'Annually'];
        const match = options.find((o) => o.toLowerCase() === v.toLowerCase());
        return match || v;
      };
      break;
  }

  return resolvers;
}

/**
 * Auto-map column headers to entity field keys.
 * Returns a mapping object: { columnIndex: fieldKey }
 */
export function autoMapColumns(headers, entityFields) {
  const mapping = {};

  headers.forEach((header, idx) => {
    if (!header) return;
    const h = header.trim().toLowerCase();

    // Try exact label match
    let match = entityFields.find((f) => f.label.toLowerCase() === h);
    if (match) {
      mapping[idx] = match.key;
      return;
    }

    // Try exact key match
    match = entityFields.find((f) => f.key.toLowerCase() === h);
    if (match) {
      mapping[idx] = match.key;
      return;
    }

    // Try alias match
    match = entityFields.find(
      (f) => f.aliases && f.aliases.some((a) => a.toLowerCase() === h)
    );
    if (match) {
      mapping[idx] = match.key;
      return;
    }

    // Try partial match on label
    match = entityFields.find((f) => f.label.toLowerCase().includes(h) || h.includes(f.label.toLowerCase()));
    if (match && !Object.values(mapping).includes(match.key)) {
      mapping[idx] = match.key;
    }
  });

  return mapping;
}

/**
 * Apply resolvers to a row of imported data.
 * Returns the row with resolved IDs where applicable.
 */
export function resolveRow(row, resolvers) {
  const resolved = { ...row };
  Object.entries(resolvers).forEach(([key, resolver]) => {
    if (resolved[key] !== undefined && resolved[key] !== null && resolved[key] !== '') {
      const result = resolver(resolved[key]);
      if (result !== null) {
        resolved[key] = result;
      }
    }
  });
  return resolved;
}
