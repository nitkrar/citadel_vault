import { cleanEntry, buildCsv, downloadBlob, TYPE_LABELS, applyFieldVisibility } from './exportHelpers';

/**
 * Export all entry types as individual CSVs bundled into a single ZIP file.
 *
 * @param {Object} grouped - Output of assignRowIdsAndRemap()
 * @param {string} dateSuffix - Date string appended to the filename
 * @param {Object[]} [templates] - Template objects (needed for field visibility filtering)
 * @param {{ secrets?: boolean, monetary?: boolean, rates?: boolean }} [fieldVisibility]
 */
export async function exportCsvZip(grouped, dateSuffix, templates, fieldVisibility) {
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();

  for (const [type, entries] of Object.entries(grouped)) {
    if (entries.length === 0) continue;

    let cleanedItems = entries.map(cleanEntry);
    if (fieldVisibility) {
      const tmpl = templates?.find(t => t.template_key === type && !t.owner_id);
      const fields = tmpl?.fields
        ? (typeof tmpl.fields === 'string' ? JSON.parse(tmpl.fields) : (Array.isArray(tmpl.fields) ? tmpl.fields : []))
        : [];
      cleanedItems = cleanedItems.map(item => applyFieldVisibility(item, fields, fieldVisibility));
    }
    const csv = buildCsv(cleanedItems);
    const label = TYPE_LABELS[type] || type;
    const filename = `${label.toLowerCase()}.csv`;
    zip.file(filename, csv);
  }

  const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/zip' });
  downloadBlob(blob, `citadel-export-${dateSuffix}.zip`);
}
