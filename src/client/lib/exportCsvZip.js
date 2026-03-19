import { cleanEntry, buildCsv, downloadBlob, TYPE_LABELS } from './exportHelpers';

/**
 * Export all entry types as individual CSVs bundled into a single ZIP file.
 *
 * @param {Object} grouped - Output of assignRowIdsAndRemap()
 * @param {string} dateSuffix - Date string appended to the filename
 */
export async function exportCsvZip(grouped, dateSuffix) {
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();

  for (const [type, entries] of Object.entries(grouped)) {
    if (entries.length === 0) continue;

    const cleanedItems = entries.map(cleanEntry);
    const csv = buildCsv(cleanedItems);
    const label = TYPE_LABELS[type] || type;
    const filename = `${label.toLowerCase()}.csv`;
    zip.file(filename, csv);
  }

  const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/zip' });
  downloadBlob(blob, `citadel-export-${dateSuffix}.zip`);
}
