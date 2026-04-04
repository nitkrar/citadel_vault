/**
 * XLSX exporter — produces a workbook with one worksheet per entry type.
 * Uses SheetJS (xlsx) via dynamic import.
 */

import { cleanEntry, TYPE_LABELS, applyFieldVisibility } from './exportHelpers';

/**
 * Export grouped vault entries to an XLSX file.
 *
 * @param {Object} grouped - Output of assignRowIdsAndRemap()
 * @param {string} dateSuffix - Date string appended to the filename
 * @param {Object[]} [templates] - Template objects (needed for field visibility filtering)
 * @param {{ secrets?: boolean, monetary?: boolean, rates?: boolean }} [fieldVisibility]
 */
export async function exportXlsx(grouped, dateSuffix, templates, fieldVisibility) {
  const XLSX = await import('xlsx');

  const wb = XLSX.utils.book_new();

  for (const [type, entries] of Object.entries(grouped)) {
    if (!entries || entries.length === 0) continue;

    let cleanedItems = entries.map(cleanEntry);
    if (fieldVisibility) {
      const tmpl = templates?.find(t => t.template_key === type && !t.owner_id);
      const fields = tmpl?.fields
        ? (typeof tmpl.fields === 'string' ? JSON.parse(tmpl.fields) : (Array.isArray(tmpl.fields) ? tmpl.fields : []))
        : [];
      cleanedItems = cleanedItems.map(item => applyFieldVisibility(item, fields, fieldVisibility));
    }
    const ws = XLSX.utils.json_to_sheet(cleanedItems);
    const sheetName = TYPE_LABELS[type] || type;
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  }

  const filename = `citadel-export-${dateSuffix}.xlsx`;
  XLSX.writeFile(wb, filename);
}
