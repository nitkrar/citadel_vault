<?php
// Serve the built SPA index.html
// This replaces the dev index.html when accessed via .htaccess
$builtIndex = __DIR__ . '/dist/index.html';
if (file_exists($builtIndex)) {
    readfile($builtIndex);
} else {
    http_response_code(500);
    echo 'Build not found. Run: npm run build';
}
