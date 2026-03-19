/**
 * XLSX exporter — produces a workbook with one worksheet per entry type.
 * Uses SheetJS (xlsx) via dynamic import.
 */

import { cleanEntry, TYPE_LABELS } from './exportHelpers';

/**
 * Export grouped vault entries to an XLSX file.
 *
 * @param {Object} grouped - Output of assignRowIdsAndRemap()
 * @param {string} dateSuffix - Date string appended to the filename
 */
export async function exportXlsx(grouped, dateSuffix) {
  const XLSX = await import('xlsx');

  const wb = XLSX.utils.book_new();

  for (const [type, entries] of Object.entries(grouped)) {
    if (!entries || entries.length === 0) continue;

    const cleanedItems = entries.map(cleanEntry);
    const ws = XLSX.utils.json_to_sheet(cleanedItems);
    const sheetName = TYPE_LABELS[type] || type;
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  }

  const filename = `citadel-export-${dateSuffix}.xlsx`;
  XLSX.writeFile(wb, filename);
}
