<?php
/**
 * Citadel Vault — Storage Factory
 *
 * Returns the configured StorageAdapter instance based on the STORAGE_ADAPTER
 * constant from config. Default: 'mariadb'.
 *
 * Usage:
 *   $adapter = Storage::adapter();
 *   $entries = $adapter->getEntries($userId);
 */
require_once __DIR__ . '/StorageAdapter.php';
require_once __DIR__ . '/MariaDbAdapter.php';
require_once __DIR__ . '/InMemoryAdapter.php';

class Storage {

    private static ?StorageAdapter $instance = null;

    /**
     * Get the configured storage adapter (singleton).
     *
     * Reads the STORAGE_ADAPTER constant (set in config/config.php).
     * Falls back to 'mariadb' if the constant is not defined.
     *
     * @return StorageAdapter
     * @throws \RuntimeException If the configured adapter is unknown
     */
    public static function adapter(): StorageAdapter {
        if (self::$instance === null) {
            $adapterName = defined('STORAGE_ADAPTER') ? STORAGE_ADAPTER : 'mariadb';

            self::$instance = match ($adapterName) {
                'mariadb' => new MariaDbAdapter(),
                'memory'  => new InMemoryAdapter(),
                default   => throw new \RuntimeException(
                    "Unknown storage adapter: '{$adapterName}'. Supported: mariadb, memory."
                ),
            };
        }
        return self::$instance;
    }

    /**
     * Reset the singleton (useful for testing).
     */
    public static function reset(): void {
        self::$instance = null;
    }
}
