/**
 * entityFieldConfigs.js — Single source of truth for field metadata per entity.
 * Used by BulkEditModal, BulkAddModal, ImportModal, and BulkWizard.
 *
 * Field shape:
 *   key         — API field name
 *   label       — Display label
 *   type        — 'text' | 'number' | 'select' | 'checkbox' | 'textarea' | 'date'
 *   required    — boolean (for create validation)
 *   refKey      — key in referenceData for select options
 *   displayKey  — which field on refData item to display
 *   displayFn   — custom function to format display text
 *   nullable    — field can be null/empty
 *   aliases     — column name aliases for import column mapping
 */

export const ENTITY_FIELDS = {
  assets: [
    { key: 'name', label: 'Name', type: 'text', required: true, aliases: ['asset name', 'asset'] },
    { key: 'asset_type_id', label: 'Asset Type', type: 'select', required: true, refKey: 'assetTypes', displayKey: 'name', aliases: ['type', 'asset type'] },
    { key: 'account_id', label: 'Account', type: 'select', refKey: 'accounts', displayKey: 'name', nullable: true, aliases: ['account'] },
    { key: 'currency_id', label: 'Currency', type: 'select', required: true, refKey: 'currencies', displayFn: (c) => `${c.symbol} ${c.code}`, aliases: ['currency'] },
    { key: 'country_id', label: 'Country', type: 'select', refKey: 'countries', displayFn: (c) => `${c.flag_emoji} ${c.name}`, nullable: true, aliases: ['country'] },
    { key: 'amount', label: 'Amount', type: 'number', required: true, aliases: ['value', 'balance'] },
    { key: 'is_liquid', label: 'Liquid', type: 'checkbox', aliases: ['liquid'] },
    { key: 'is_liability', label: 'Liability', type: 'checkbox', aliases: ['liability'] },
    { key: 'comments', label: 'Comments', type: 'textarea', nullable: true, aliases: ['notes', 'comment'] },
  ],

  accounts: [
    { key: 'name', label: 'Name', type: 'text', required: true, aliases: ['account name', 'account'] },
    { key: 'institution', label: 'Institution', type: 'text', nullable: true, aliases: ['bank', 'provider'] },
    { key: 'account_type_id', label: 'Account Type', type: 'select', required: true, refKey: 'accountTypes', displayKey: 'name', aliases: ['type', 'account type'] },
    { key: 'subtype', label: 'Subtype', type: 'select', options: ['isa', 'sipp', '401k', 'nps', 'ppf', 'epf'], optionLabel: (v) => v.toUpperCase(), nullable: true, aliases: ['sub type'] },
    { key: 'country_id', label: 'Country', type: 'select', refKey: 'countries', displayFn: (c) => `${c.flag_emoji} ${c.name}`, nullable: true, aliases: ['country'] },
    { key: 'currency_id', label: 'Currency', type: 'select', required: true, refKey: 'currencies', displayFn: (c) => `${c.symbol} ${c.code}`, aliases: ['currency'] },
    { key: 'customer_id', label: 'Customer ID', type: 'text', nullable: true, aliases: ['customer number', 'member id'] },
    { key: 'comments', label: 'Comments', type: 'textarea', nullable: true, aliases: ['notes', 'comment'] },
  ],

  licenses: [
    { key: 'product_name', label: 'Product Name', type: 'text', required: true, aliases: ['product', 'software', 'name'] },
    { key: 'vendor', label: 'Vendor', type: 'text', nullable: true, aliases: ['publisher', 'company'] },
    { key: 'license_key', label: 'License Key', type: 'text', nullable: true, aliases: ['key', 'serial', 'serial number', 'activation key'] },
    { key: 'category', label: 'Category', type: 'text', nullable: true, aliases: ['type'] },
    { key: 'purchase_date', label: 'Purchase Date', type: 'date', nullable: true, aliases: ['purchased', 'bought'] },
    { key: 'expiry_date', label: 'Expiry Date', type: 'date', nullable: true, aliases: ['expires', 'expiration', 'expiration date'] },
    { key: 'seats', label: 'Seats', type: 'number', nullable: true, aliases: ['licenses', 'quantity'] },
    { key: 'notes', label: 'Notes', type: 'textarea', nullable: true, aliases: ['comments', 'description'] },
  ],

  insurance: [
    { key: 'policy_name', label: 'Policy Name', type: 'text', required: true, aliases: ['name', 'policy'] },
    { key: 'provider', label: 'Provider', type: 'text', nullable: true, aliases: ['insurer', 'company', 'carrier'] },
    { key: 'policy_number', label: 'Policy Number', type: 'text', nullable: true, aliases: ['number', 'policy no'] },
    { key: 'category', label: 'Category', type: 'select', required: false, options: ['Life', 'Health', 'Vehicle', 'Property', 'Other'], aliases: ['type'] },
    { key: 'premium_amount', label: 'Premium Amount', type: 'number', nullable: true, aliases: ['premium'] },
    { key: 'coverage_amount', label: 'Coverage Amount', type: 'number', nullable: true, aliases: ['coverage', 'sum assured'] },
    { key: 'cash_value', label: 'Cash Value', type: 'number', nullable: true, aliases: ['cash'] },
    { key: 'payment_frequency', label: 'Payment Frequency', type: 'select', options: ['Monthly', 'Quarterly', 'Annually'], nullable: true, aliases: ['frequency'] },
    { key: 'start_date', label: 'Start Date', type: 'date', nullable: true, aliases: ['start', 'effective date'] },
    { key: 'maturity_date', label: 'Maturity Date', type: 'date', nullable: true, aliases: ['maturity', 'end date', 'expiry'] },
    { key: 'notes', label: 'Notes', type: 'textarea', nullable: true, aliases: ['comments'] },
  ],

  vault: [
    { key: 'title', label: 'Title', type: 'text', required: true, aliases: ['name', 'entry', 'site'] },
    { key: 'website_url', label: 'Website URL', type: 'text', nullable: true, aliases: ['url', 'website', 'site url'] },
    { key: 'username', label: 'Username', type: 'text', nullable: true, aliases: ['user', 'email', 'login'] },
    { key: 'password', label: 'Password', type: 'text', required: true, aliases: ['pass', 'pwd'] },
    { key: 'category', label: 'Category', type: 'text', nullable: true, aliases: ['type', 'group'] },
    { key: 'is_favourite', label: 'Favourite', type: 'checkbox', aliases: ['favorite', 'starred', 'fav'] },
    { key: 'notes', label: 'Notes', type: 'textarea', nullable: true, aliases: ['comments', 'description'] },
  ],
};

/**
 * Get fields suitable for bulk edit (excludes fields that shouldn't be bulk-edited).
 * For vault, password is excluded from bulk edit.
 */
export function getBulkEditFields(entityType) {
  const fields = ENTITY_FIELDS[entityType] || [];
  if (entityType === 'vault') {
    return fields.filter((f) => f.key !== 'password');
  }
  return fields;
}

/**
 * Get the entity API endpoint name for bulk operations.
 */
export function getEntityApiName(entityType) {
  return entityType; // 'assets', 'accounts', 'licenses', 'insurance', 'vault'
}

/**
 * Get display name for entity type.
 */
export function getEntityDisplayName(entityType, plural = true) {
  const names = {
    assets: ['Asset', 'Assets'],
    accounts: ['Account', 'Accounts'],
    licenses: ['License', 'Licenses'],
    insurance: ['Policy', 'Insurance Policies'],
    vault: ['Entry', 'Vault Entries'],
  };
  return names[entityType]?.[plural ? 1 : 0] || entityType;
}
