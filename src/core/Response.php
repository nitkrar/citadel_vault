<?php
/**
 * Personal Vault — Response Helper
 * Handles CORS, JSON output, request body parsing, and sanitization.
 */
class Response {
    /**
     * Set CORS headers and handle OPTIONS preflight.
     */
    public static function setCors(): void {
        $origin = $_SERVER['HTTP_ORIGIN'] ?? '*';
        $allowed = ALLOWED_ORIGINS;

        if ($allowed === '*') {
            header('Access-Control-Allow-Origin: *');
        } else {
            $allowedList = array_map('trim', explode(',', $allowed));
            if (in_array($origin, $allowedList, true)) {
                header("Access-Control-Allow-Origin: $origin");
                header('Access-Control-Allow-Credentials: true');
                header('Vary: Origin');
            }
        }

        header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
        header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Data-Token');
        header('Access-Control-Max-Age: 86400');

        if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
            http_response_code(204);
            exit;
        }

        header('Content-Type: application/json; charset=utf-8');
    }

    /**
     * Send a success response.
     */
    public static function success($data = null, int $code = 200): void {
        http_response_code($code);
        die(json_encode(['success' => true, 'data' => $data]));
    }

    /**
     * Send an error response.
     */
    public static function error(string $message, int $code = 400): void {
        http_response_code($code);
        die(json_encode(['success' => false, 'error' => $message]));
    }

    /**
     * Parse the JSON request body.
     */
    public static function getBody(): array {
        $raw = $_SERVER['_RAW_INPUT'] ?? file_get_contents('php://input');
        $data = json_decode($raw, true);
        return is_array($data) ? $data : [];
    }

    /**
     * Sanitize a string input.
     */
    public static function sanitize(?string $input): ?string {
        if ($input === null) return null;
        return htmlspecialchars(strip_tags(trim($input)), ENT_QUOTES, 'UTF-8');
    }

    /**
     * Sanitize a date field from request body.
     * Returns a valid YYYY-MM-DD string or null. Empty strings and invalid
     * dates become null so MySQL DATE columns with DEFAULT NULL don't reject them.
     */
    public static function sanitizeDate($input): ?string {
        if ($input === null || $input === '') return null;
        $trimmed = trim((string)$input);
        if ($trimmed === '') return null;
        // Accept YYYY-MM-DD format only
        if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $trimmed)) {
            return $trimmed;
        }
        return null;
    }

    /**
     * Register global exception/error handlers so uncaught exceptions
     * (e.g. PDOException from a failed INSERT) return a proper JSON error
     * instead of a raw 500 with no body.
     */
    public static function registerErrorHandlers(): void {
        set_exception_handler(function (\Throwable $e) {
            // Prevent double-header if headers already sent
            if (!headers_sent()) {
                http_response_code(500);
                header('Content-Type: application/json; charset=utf-8');
            }

            $isDev = (defined('APP_ENV') && APP_ENV === 'development')
                  || (getenv('APP_ENV') === 'development');

            $response = [
                'success' => false,
                'error'   => $isDev
                    ? $e->getMessage()
                    : 'An unexpected error occurred. Please try again.',
            ];

            die(json_encode($response));
        });
    }
}

// Auto-register handlers when Response class is loaded — every API endpoint
// includes this file, so all endpoints get proper error responses automatically.
Response::registerErrorHandlers();
