<?php
// Development router for: php -S localhost:8081 router.php
$uri = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);

// Security headers for all responses
header("X-Content-Type-Options: nosniff");
header("X-Frame-Options: DENY");
header("Referrer-Policy: strict-origin-when-cross-origin");
header("Permissions-Policy: camera=(), microphone=(), geolocation=()");

// API routes
if (preg_match('#^/src/api/(.+\.php)#', $uri, $m)) {
    $file = __DIR__ . '/src/api/' . $m[1];
    if (file_exists($file)) {
        $_SERVER['_RAW_INPUT'] = file_get_contents('php://input');
        require $file;
        return true;
    }
}

// Static assets from public/ (CSS, JS, images, fonts)
$publicFile = __DIR__ . '/public' . $uri;
if ($uri !== '/' && file_exists($publicFile) && !is_dir($publicFile)) {
    $mimeTypes = [
        'css' => 'text/css',
        'js' => 'application/javascript',
        'svg' => 'image/svg+xml',
        'png' => 'image/png',
        'jpg' => 'image/jpeg',
        'ico' => 'image/x-icon',
        'woff' => 'font/woff',
        'woff2' => 'font/woff2',
        'json' => 'application/json',
        'html' => 'text/html',
    ];
    $ext = strtolower(pathinfo($publicFile, PATHINFO_EXTENSION));
    $mime = $mimeTypes[$ext] ?? 'application/octet-stream';
    header("Content-Type: $mime");
    // Hashed filenames (in /assets/) are immutable — cache forever
    // Non-hashed files (index.html, styles.css) — no cache
    if (strpos($uri, '/assets/') !== false) {
        header('Cache-Control: public, max-age=31536000, immutable');
    } else {
        header('Cache-Control: no-cache, must-revalidate');
    }
    readfile($publicFile);
    return true;
}

// SPA fallback — serve built index.html via index.php
require __DIR__ . '/index.php';
return true;

http_response_code(404);
echo 'Not found';
