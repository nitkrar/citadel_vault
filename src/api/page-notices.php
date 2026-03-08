<?php
/**
 * Page Notices API — serves config-driven banners for any page.
 * Edit config/page-notices.json to add/remove notices without code changes.
 * Public endpoint (no auth required).
 */
require_once __DIR__ . '/../core/Response.php';
require_once __DIR__ . '/../../config/config.php';

Response::setCors();

$file = __DIR__ . '/../../config/page-notices.json';
if (!file_exists($file)) {
    Response::success([]);
}

$content = file_get_contents($file);
$notices = json_decode($content, true);

if (!is_array($notices)) {
    Response::success([]);
}

Response::success($notices);
