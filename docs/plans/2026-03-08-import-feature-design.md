# Import Feature — Design Document

**Date:** 2026-03-08
**Status:** Approved (brainstorming complete)
**Scope:** Add import functionality, fix XLSX export, add PWA icons

---

## 1. Import Feature

### Architecture

**100% client-side.** Browser parses the file, maps columns to template fields, encrypts each row, then batch-POSTs encrypted blobs to `vault.php?action=bulk-create`. The server never sees plaintext data.

### 2-Step Wizard

**Step 1: Upload**
- Drag & drop or file picker (CSV, XLSX)
- Google Sheets URL (first tab only; note: "For multi-tab sheets, download as Excel")
- Download template buttons per entry type (headers from template fields)

**Step 2: Review + Import**
- Auto-mapped columns shown in table format
- Unmapped columns greyed out with dropdown to manually assign
- Unmapped required fields flagged with warning
- Entry type dropdown (pre-filled via auto-detection from headers)
- For XLSX multi-sheet: tabbed view, one tab per sheet, checkboxes to include/exclude
- **Import** button → encrypt each row → bulk-create → progress bar → results

### Auto-Detection

**Entry type detection:** Fuzzy match column headers against all template field labels. The type whose templates match the most headers wins. If ambiguous, show a type picker.

**Column mapping:** For each CSV header, find the closest matching template field label using case-insensitive substring matching. Example: "Password" → field key `password`, "Web Site" → field key `url`, "User Name" → field key `username`.

### File Format Handling

| Format | Behavior |
|--------|----------|
| CSV | Single entry type. Auto-detect or user picks. |
| XLSX | Multi-sheet. Each sheet matched to entry type by name. Tabbed review. |
| Google Sheets URL | Fetched as CSV (first tab only). Note shown for multi-tab sheets. |

### Entry Points

1. **VaultPage** — "Import" button next to "New Entry". Opens import modal.
2. **Import / Export page** — Import section at top, export section below.

### Page Rename

`ExportPage.jsx` → `ImportExportPage.jsx`. Route: `/import-export`. Nav label: "Import / Export".

---

## 2. XLSX Export (Fix)

The ExportPage currently supports JSON and CSV. The plan specified CSV/XLSX/JSON. Add XLSX export using the existing `xlsx` dependency (already in package.json).

---

## 3. PWA Icons

The manifest references `favicon-192.png` and `favicon-512.png` but the files don't exist in `static/`. Generate simple placeholder icons using the Citadel shield branding. These go in `static/` and are copied to `dist/` by Vite.

---

## Decision Log

1. Import is 100% client-side — server never sees plaintext
2. 2-step wizard (Upload → Review+Import) — simplified from original 4-step
3. Auto-map columns via fuzzy matching, manual override for failures
4. CSV = single type, XLSX = multi-sheet with tabs
5. Google Sheets = CSV fetch of first tab only
6. Import button on VaultPage + Import/Export page
7. ExportPage renamed to ImportExportPage
8. XLSX export uses existing `xlsx` dependency
9. PWA icons are simple placeholders — can be replaced with designed icons later
