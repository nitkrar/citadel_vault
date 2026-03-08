<?php
/**
 * Docs API — Serve markdown documentation files.
 * Public endpoint (no auth required).
 */
require_once __DIR__ . '/../core/Response.php';
require_once __DIR__ . '/../../config/config.php';

Response::setCors();

$method = $_SERVER['REQUEST_METHOD'];

if ($method !== 'GET') {
    Response::error('Method not allowed.', 405);
}

$file = $_GET['file'] ?? '';

// Whitelist of allowed files (relative to project root)
$allowed = [
    'readme'    => __DIR__ . '/../../README.md',
    'changelog' => __DIR__ . '/../../CHANGELOG.md',
];

if (!isset($allowed[$file])) {
    Response::error('Unknown document. Allowed: ' . implode(', ', array_keys($allowed)), 400);
}

$path = $allowed[$file];
if (!file_exists($path)) {
    Response::error('Document not found.', 404);
}

$content = file_get_contents($path);

Response::success([
    'file'    => $file,
    'content' => $content,
]);
