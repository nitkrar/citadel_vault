/**
 * Import utilities for CSV/XLSX parsing, column auto-mapping, and template generation.
 * 100% client-side — no server involvement.
 */

// ── Common aliases for fuzzy matching ──────────────────────────────────

const FIELD_ALIASES = {
    title: ['title', 'name', 'label', 'entry name', 'item name', 'site name'],
    url: ['url', 'website', 'web site', 'website url', 'site url', 'link', 'web address'],
    username: ['username', 'user name', 'user', 'login', 'email', 'account'],
    password: ['password', 'pass', 'secret', 'credential', 'pwd'],
    notes: ['notes', 'note', 'comments', 'comment', 'description', 'memo'],
    institution: ['institution', 'bank', 'bank name', 'provider', 'company'],
    account_number: ['account number', 'account no', 'account #', 'acct number', 'acct no'],
    sort_code: ['sort code', 'sort_code', 'routing', 'bsb'],
    routing_number: ['routing number', 'routing no', 'routing #', 'aba'],
    balance: ['balance', 'amount', 'value', 'current balance'],
    currency: ['currency', 'ccy', 'cur'],
    interest_rate: ['interest rate', 'rate', 'apr', 'apy', 'interest'],
    license_key: ['license key', 'licence key', 'serial', 'serial number', 'product key', 'activation key', 'key', 'cd key'],
    vendor: ['vendor', 'publisher', 'developer', 'company', 'maker'],
    policy_number: ['policy number', 'policy no', 'policy #', 'policy id'],
    premium_amount: ['premium', 'premium amount', 'monthly premium', 'annual premium'],
    coverage_amount: ['coverage', 'coverage amount', 'sum assured', 'sum insured'],
    expiry_date: ['expiry', 'expiry date', 'expiration', 'expiration date', 'exp date', 'expires', 'valid until'],
    start_date: ['start date', 'start', 'effective date', 'issue date', 'from date'],
    maturity_date: ['maturity', 'maturity date', 'end date'],
    purchase_date: ['purchase date', 'bought', 'acquired'],
};

const TYPE_ALIASES = {
    password: ['password', 'passwords', 'credential', 'credentials', 'login', 'logins', 'vault'],
    account: ['account', 'accounts', 'bank', 'bank account', 'bank accounts', 'finance'],
    asset: ['asset', 'assets', 'investment', 'investments', 'property', 'properties'],
    license: ['license', 'licenses', 'licence', 'licences', 'software', 'serial', 'serials'],
    insurance: ['insurance', 'policies', 'insurance policy', 'insurance policies', 'policy'],
    custom: ['custom', 'other', 'misc', 'miscellaneous'],
};

// ── Fuzzy matching ─────────────────────────────────────────────────────

/**
 * Fuzzy match a CSV header to a template field.
 * Returns the best-matching field key or null.
 */
export function fuzzyMatchField(header, fields) {
    if (!header || !fields.length) return null;
    const h = header.toLowerCase().trim();

    // 1. Exact match on field key or label
    for (const f of fields) {
        if (f.key === h || f.label.toLowerCase() === h) return f.key;
    }

    // 2. Match via known aliases
    for (const [fieldKey, aliases] of Object.entries(FIELD_ALIASES)) {
        if (aliases.some(a => a === h)) {
            const match = fields.find(f => f.key === fieldKey);
            if (match) return match.key;
        }
    }

    // 3. Substring match (header contains field label or vice versa)
    for (const f of fields) {
        const label = f.label.toLowerCase();
        if (h.includes(label) || label.includes(h)) return f.key;
    }

    // 4. Partial alias match (header contains alias)
    for (const [fieldKey, aliases] of Object.entries(FIELD_ALIASES)) {
        if (aliases.some(a => h.includes(a) || a.includes(h))) {
            const match = fields.find(f => f.key === fieldKey);
            if (match) return match.key;
        }
    }

    return null;
}

/**
 * Auto-map all CSV headers to template fields.
 * Returns { columnIndex: fieldKey } mapping.
 */
export function autoMapColumns(headers, fields) {
    const mapping = {};
    const usedFields = new Set();

    for (let i = 0; i < headers.length; i++) {
        const match = fuzzyMatchField(headers[i], fields.filter(f => !usedFields.has(f.key)));
        if (match) {
            mapping[i] = match;
            usedFields.add(match);
        }
    }

    return mapping;
}

/**
 * Detect entry type from CSV headers by matching against all templates.
 * Returns { type, templateId, confidence } where confidence is 0-1.
 */
export function detectEntryType(headers, templates) {
    if (!headers.length || !templates.length) return { type: 'password', templateId: null, confidence: 0 };

    let bestType = 'password';
    let bestTemplateId = null;
    let bestScore = 0;

    for (const tpl of templates) {
        const fields = typeof tpl.fields === 'string' ? JSON.parse(tpl.fields) : (tpl.fields || []);
        if (!fields.length) continue;

        const mapping = autoMapColumns(headers, fields);
        const mappedCount = Object.keys(mapping).length;
        const requiredFields = fields.filter(f => f.required);
        const mappedRequired = requiredFields.filter(f => Object.values(mapping).includes(f.key)).length;

        // Score: mapped required fields weigh 2x, other mapped fields weigh 1x
        const score = (mappedRequired * 2 + (mappedCount - mappedRequired)) / (fields.length + requiredFields.length || 1);

        if (score > bestScore) {
            bestScore = score;
            bestType = tpl.template_key;
            bestTemplateId = tpl.id;
        }
    }

    return { type: bestType, templateId: bestTemplateId, confidence: bestScore };
}

/**
 * Match a sheet name to an entry type.
 */
export function matchSheetToType(sheetName) {
    const normalized = sheetName.toLowerCase().trim();
    for (const [type, aliases] of Object.entries(TYPE_ALIASES)) {
        if (aliases.some(a => normalized === a || normalized.includes(a))) return type;
    }
    return null;
}

// ── File parsing ───────────────────────────────────────────────────────

/**
 * Parse CSV text into { headers, rows }.
 * Handles quoted fields with commas.
 */
export function parseCsv(text) {
    const lines = text.trim().split('\n').map(line => {
        const result = [];
        let current = '';
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (ch === '"') {
                inQuotes = !inQuotes;
            } else if (ch === ',' && !inQuotes) {
                result.push(current.trim());
                current = '';
            } else {
                current += ch;
            }
        }
        result.push(current.trim());
        return result;
    });

    if (lines.length < 2) {
        throw new Error('File must have at least a header row and one data row.');
    }

    return {
        headers: lines[0],
        rows: lines.slice(1).filter(row => row.some(cell => cell.trim())),
    };
}

/**
 * Parse XLSX ArrayBuffer into { sheets: [{ name, headers, rows }] }.
 */
export async function parseXlsx(data) {
    const XLSX = await import('xlsx');
    const wb = XLSX.read(data, { type: 'array' });

    return {
        sheets: wb.SheetNames.map(name => {
            const sheet = wb.Sheets[name];
            const json = XLSX.utils.sheet_to_json(sheet, { header: 1 });

            if (json.length < 2) return { name, headers: [], rows: [] };

            return {
                name,
                headers: json[0].map(h => String(h || '')),
                rows: json.slice(1).filter(row =>
                    row.some(cell => cell !== null && cell !== undefined && String(cell).trim())
                ),
            };
        }).filter(s => s.headers.length > 0),
    };
}

// ── Template generation ────────────────────────────────────────────────

/**
 * Generate a CSV template string for given fields.
 */
export function generateCsvTemplate(fields) {
    return fields.map(f => f.label).join(',') + '\n';
}

/**
 * Generate an XLSX template workbook with sheets per entry type.
 */
export async function generateXlsxTemplate(templatesByType) {
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();

    for (const [typeName, fields] of Object.entries(templatesByType)) {
        const headers = fields.map(f => f.label);
        const ws = XLSX.utils.aoa_to_sheet([headers]);
        ws['!cols'] = headers.map(h => ({ wch: Math.max(h.length + 4, 14) }));
        XLSX.utils.book_append_sheet(wb, ws, typeName);
    }

    return wb;
}
