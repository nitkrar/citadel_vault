/**
 * JSON export — vault entries nested by type.
 */

import { cleanEntry, downloadBlob, VALID_ENTRY_TYPES } from './exportHelpers';

const PLURAL_KEYS = {
  password: 'passwords',
  account: 'accounts',
  asset: 'assets',
  license: 'licenses',
  insurance: 'insurance',
  custom: 'custom',
};

export function exportJson(grouped, dateSuffix) {
  const payload = {
    version: 1,
    exported_at: new Date().toISOString(),
  };

  for (const type of VALID_ENTRY_TYPES) {
    const key = PLURAL_KEYS[type];
    const entries = grouped[type] || [];
    payload[key] = entries.map(cleanEntry);
  }

  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  downloadBlob(blob, `citadel-export-${dateSuffix}.json`);
}
