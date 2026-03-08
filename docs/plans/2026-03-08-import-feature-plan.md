# Import Feature Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use 10x-engineer:executing-plans to implement this plan task-by-task.

**Goal:** Add CSV/XLSX import with auto-mapping, fix XLSX export, add PWA icons.

**Architecture:** Client-side import wizard that parses files in the browser, auto-maps columns to template fields, encrypts each row with the user's DEK, and batch-creates entries via the existing `vault.php?action=bulk-create` API. No server changes needed.

**Tech Stack:** React 19, `xlsx` library (existing dep), Web Crypto API (existing), IndexedDB entry store (existing), Vite PWA plugin (existing)

---

## Task Dependencies

| Task | Parallel Group | Depends On | Files Touched |
|------|---------------|------------|---------------|
| 1: Import utility functions | A | — | `src/client/lib/importUtils.js` (new) |
| 2: PWA icons | A | — | `static/favicon-192.png`, `static/favicon-512.png` (new) |
| 3: ImportModal rewrite | B | Task 1 | `src/client/components/ImportModal.jsx` |
| 4: ImportExportPage (rename + add import) | C | Task 3 | `src/client/pages/ImportExportPage.jsx` (new), delete `src/client/pages/ExportPage.jsx` |
| 5: VaultPage import button | C | Task 3 | `src/client/pages/VaultPage.jsx` |
| 6: Router + nav update | D | Task 4 | `src/client/App.jsx`, `src/client/components/Layout.jsx` |
| 7: Delete old import files | D | Task 3 | `src/client/lib/importResolvers.js` (delete) |
| 8: Build verification | E | Tasks 6, 7 | `dist/` |

**Parallel execution:** Group A (2 tasks) first. Group B after A. Groups C after B. Group D after C. Group E final.

---

### Task 1: Import Utility Functions
**Parallel group:** A

**Files:**
- Create: `src/client/lib/importUtils.js`

**Step 1: Write the utility module**

Create `src/client/lib/importUtils.js` with these functions:

```js
/**
 * Fuzzy match a CSV header to a template field label.
 * Returns the best-matching field key or null.
 */
export function fuzzyMatchField(header, fields)

/**
 * Auto-map all CSV headers to template fields.
 * Returns { columnIndex: fieldKey } mapping.
 */
export function autoMapColumns(headers, fields)

/**
 * Detect entry type from CSV headers by matching against all templates.
 * Returns { type: string, templateId: number|null, confidence: number }
 */
export function detectEntryType(headers, templates)

/**
 * Parse CSV text into { headers: string[], rows: string[][] }.
 * Handles quoted fields with commas and newlines.
 */
export function parseCsv(text)

/**
 * Parse XLSX ArrayBuffer into { sheets: [{ name, headers, rows }] }.
 * Uses dynamic import of 'xlsx' library.
 */
export async function parseXlsx(data)

/**
 * Match sheet names to entry types.
 * "Passwords" → 'password', "Bank Accounts" → 'account', etc.
 */
export function matchSheetToType(sheetName)

/**
 * Generate a CSV template string for a given template's fields.
 */
export function generateCsvTemplate(fields)

/**
 * Generate an XLSX workbook with one sheet per entry type.
 */
export async function generateXlsxTemplate(templates)
```

Implementation details:
- `fuzzyMatchField`: case-insensitive, try exact match first, then substring, then common aliases (e.g., "web site" → "url", "user name" → "username", "pass" → "password")
- `parseCsv`: reuse the CSV parser from the old ImportModal (it handles quotes correctly)
- `parseXlsx`: dynamic `import('xlsx')` to avoid loading the library until needed
- `matchSheetToType`: normalize sheet name to lowercase, match against known types + common aliases
- `detectEntryType`: for each template, count how many of its required fields match the CSV headers. Highest count wins.

**Step 2: Commit**

```bash
git commit -m "Add import utility functions for CSV/XLSX parsing and auto-mapping"
```

---

### Task 2: PWA Icons
**Parallel group:** A

**Files:**
- Create: `static/favicon-192.png`
- Create: `static/favicon-512.png`

**Step 1: Generate placeholder icons**

Create simple SVG-based PNG icons with the Citadel shield motif. Use a dark blue background (#1a1a2e) with a white shield outline. Two sizes: 192x192 and 512x512.

Since we can't run image generation tools, create an SVG and note that the user should convert it to PNG, OR use a simple canvas-based script. For now, copy the existing favicon if one exists in `static/`, or create a minimal placeholder.

Check if any existing favicon/icon exists:
```bash
ls static/favicon* static/*.png static/*.ico 2>/dev/null
```

If no icons exist, create a simple `static/icon.svg` that can be referenced, and note that proper PNG icons need to be generated.

**Step 2: Commit**

```bash
git commit -m "Add PWA icon placeholders"
```

---

### Task 3: ImportModal Rewrite
**Parallel group:** B (depends on Task 1)

**Files:**
- Rewrite: `src/client/components/ImportModal.jsx`

**Step 1: Rewrite ImportModal as 2-step wizard**

The modal accepts `{ isOpen, onClose, defaultType?, onImportComplete }` props.

**Step 1 UI — Upload:**
- Drag & drop zone or file picker (CSV, XLSX)
- Google Sheets URL field + Fetch button
- "First tab only" note for Google Sheets
- Download template buttons (CSV per type, or XLSX with all types)

**Step 2 UI — Review + Import:**

For single-type (CSV / single-sheet):
- Entry type dropdown (pre-filled from auto-detection)
- Template variant selector (if subtypes exist)
- Table showing auto-mapped data
- Unmapped columns: dropdown to assign to a template field
- Required field warnings
- "Import" button

For multi-sheet (XLSX):
- Tabs: one per detected sheet
- Each tab has: type dropdown + mapped table + warnings
- Checkboxes to include/exclude sheets
- "Import All" button

**Import flow:**
1. For each row: build JSON object from mapped columns
2. Call `encrypt(rowData)` from EncryptionContext
3. Collect all encrypted blobs
4. POST to `vault.php?action=bulk-create` with `{ entries: [{ entry_type, template_id, encrypted_data }] }`
5. Show progress bar during encryption + upload
6. Show results: N succeeded, M failed

**Key imports:**
```js
import { parseCsv, parseXlsx, autoMapColumns, detectEntryType, matchSheetToType } from '../lib/importUtils';
import { useEncryption } from '../contexts/EncryptionContext';
import { entryStore } from '../lib/entryStore';
import { apiData } from '../lib/checks';
import api from '../api/client';
```

**Step 2: Commit**

```bash
git commit -m "Rewrite ImportModal as 2-step client-side import wizard"
```

---

### Task 4: ImportExportPage
**Parallel group:** C (depends on Task 3)

**Files:**
- Create: `src/client/pages/ImportExportPage.jsx`
- Delete: `src/client/pages/ExportPage.jsx`

**Step 1: Create ImportExportPage**

Read the current `src/client/pages/ExportPage.jsx` first.

Create `src/client/pages/ImportExportPage.jsx` with two sections:

**Import section (top):**
- "Import" heading with description
- "Import from File" button → opens ImportModal
- Brief format support note: CSV, XLSX, Google Sheets

**Export section (bottom):**
- Copy existing ExportPage content (entry type checkboxes, format selector, export button)
- Add XLSX format option alongside CSV and JSON
- XLSX export implementation:
```js
if (format === 'xlsx') {
    const XLSX = await import('xlsx');
    const ws = XLSX.utils.json_to_sheet(decrypted);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Vault Export');
    XLSX.writeFile(wb, filename);
}
```

**Step 2: Delete ExportPage.jsx**

```bash
rm src/client/pages/ExportPage.jsx
```

**Step 3: Commit**

```bash
git commit -m "Create ImportExportPage with XLSX export support, replace ExportPage"
```

---

### Task 5: VaultPage Import Button
**Parallel group:** C (depends on Task 3)

**Files:**
- Modify: `src/client/pages/VaultPage.jsx`

**Step 1: Add import button and modal**

Read current `src/client/pages/VaultPage.jsx`.

Add to imports:
```js
import ImportModal from '../components/ImportModal';
```

Add state:
```js
const [showImport, setShowImport] = useState(false);
```

Add button to page header (next to "New Entry"):
```jsx
<button className="btn btn-secondary" onClick={() => setShowImport(true)}>
    <Upload size={16} /> Import
</button>
```

Add modal at bottom of component:
```jsx
<ImportModal
    isOpen={showImport}
    onClose={() => setShowImport(false)}
    defaultType={activeType !== 'all' ? activeType : undefined}
    onImportComplete={refetch}
/>
```

Add `Upload` to the lucide-react import.

**Step 2: Commit**

```bash
git commit -m "Add import button to VaultPage"
```

---

### Task 6: Router + Nav Update
**Parallel group:** D (depends on Task 4)

**Files:**
- Modify: `src/client/App.jsx`
- Modify: `src/client/components/Layout.jsx`

**Step 1: Update App.jsx**

Replace:
```js
import ExportPage from './pages/ExportPage';
```
With:
```js
import ImportExportPage from './pages/ImportExportPage';
```

Replace the route:
```jsx
<Route path="export" element={<ExportPage />} />
```
With:
```jsx
<Route path="import-export" element={<ImportExportPage />} />
```

**Step 2: Update Layout.jsx nav**

Replace:
```jsx
<NavLink to="/export" ...>
    <FileDown size={18} /> Export
</NavLink>
```
With:
```jsx
<NavLink to="/import-export" ...>
    <FileDown size={18} /> Import / Export
</NavLink>
```

**Step 3: Commit**

```bash
git commit -m "Update router and nav for Import / Export page"
```

---

### Task 7: Delete Old Import Files
**Parallel group:** D (depends on Task 3)

**Files:**
- Delete: `src/client/lib/importResolvers.js` (if exists)

**Step 1: Check for and delete old import helper files**

```bash
# Check what old import files exist
ls src/client/lib/importResolvers.js 2>/dev/null
```

Delete if found. Verify no other files reference it:
```bash
grep -r "importResolvers" src/client/ --include="*.jsx" --include="*.js"
```

The old `ImportModal.jsx` has already been rewritten (Task 3), so it no longer imports `importResolvers` or `entityFieldConfigs` (already deleted).

**Step 2: Commit**

```bash
git commit -m "Delete old import helper files"
```

---

### Task 8: Build Verification
**Parallel group:** E (depends on Tasks 6, 7)

**Step 1: Build**

```bash
npm run build
```

Expected: builds successfully, no missing import errors, PWA manifest includes icons.

**Step 2: Verify PWA manifest**

```bash
cat dist/manifest.webmanifest
```

Expected: icons array references favicon-192.png and favicon-512.png.

**Step 3: Verify import works (manual)**

Start dev server, unlock vault, test:
1. VaultPage → Import button → opens modal
2. Import / Export page → import section visible
3. Download CSV template → check headers match template fields
4. Upload a test CSV → auto-maps columns → review → import → entries appear
5. Export as XLSX → verify .xlsx file downloads

**Step 4: Commit**

```bash
git commit -m "Verify import feature build and PWA icons"
```
