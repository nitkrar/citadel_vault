# Citadel -- Installation Guide

Complete instructions for deploying Citadel on a fresh server or local development.

---

## Prerequisites

| Requirement           | Minimum Version       |
|-----------------------|-----------------------|
| PHP                   | 8.0+                  |
| MySQL / MariaDB       | 8.0+ / 10.5+         |
| Node.js               | 18+ (build only)      |
| PHP Extensions        | pdo_mysql, openssl, mbstring, json |
| Apache Module          | mod_rewrite (for production) |

Node.js is only required at build time to compile the React frontend. The production server needs only PHP and MySQL.

---

## Fresh Install

### 1. Clone the Repository

```bash
git clone https://github.com/nitkrar/citadel_vault.git
cd citadel_vault  # or rename to citadel
cd citadel
```

### 2. Install Dependencies and Build Frontend

```bash
npm install
npm run build
```

This compiles the React app into the `public/` directory.

### 3. Create the Database

```bash
mysql -u root -p
```

```sql
CREATE DATABASE citadel_vault_db
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
```

### 4. Load Schema and Seed Data

```bash
mysql -u root -p citadel_vault_db < database/01-schema.sql
mysql -u root -p citadel_vault_db < database/02-seed.sql
# Optional: load test data
mysql -u root -p citadel_vault_db < database/03-testdata.sql
```

This creates 19 tables and seeds:
- 140 currencies (GBP as base, GBP/INR/USD pinned to top)
- 143 countries with field templates
- 7 account types, 12 asset types
- Default admin user (`citadel_site_admin` — must change password on first login)

### 5. Create a Database User (Recommended)

```sql
CREATE USER 'vault_user'@'localhost' IDENTIFIED BY 'your-strong-password';
GRANT SELECT, INSERT, UPDATE, DELETE ON citadel_vault_db.* TO 'vault_user'@'localhost';
FLUSH PRIVILEGES;
```

### 6. Configure Environment

```bash
cp config/.env.example config/.env
```

Edit `config/.env` with your values:

```ini
# Database
DB_HOST=localhost
DB_PORT=3306
DB_NAME=citadel_vault_db
DB_USER=vault_user
DB_PASS=your-strong-password

# Security keys (generate these -- see "Generating Security Keys" below)
ENCRYPTION_KEY=<32-byte-hex>
DATA_SESSION_SECRET=<32-byte-hex>
JWT_SECRET=<64-byte-hex>

# WebAuthn (update for your domain)
WEBAUTHN_RP_ID=yourdomain.com
WEBAUTHN_RP_NAME=Citadel
WEBAUTHN_ORIGIN=https://yourdomain.com

# Application
APP_ENV=production
BASE_CURRENCY=GBP
ALLOWED_ORIGINS=https://yourdomain.com
```

### 7. Start the Server

For local development:

```bash
php -S localhost:8081 router.php
```

Open `http://localhost:8081` in your browser.

### 8. First Login

1. Log in with the default admin account (`citadel_site_admin`)
2. You will be forced to change the password on first login
3. After changing your password, set up your vault key to enable encryption
4. Save your recovery key — it's the only backup if you forget your vault key
5. Optionally register a WebAuthn passkey under Profile for passwordless login

---

## Apache Configuration

### Virtual Host Example

```apache
<VirtualHost *:443>
    ServerName vault.yourdomain.com
    DocumentRoot /var/www/citadel

    <Directory /var/www/citadel>
        AllowOverride All
        Require all granted
    </Directory>

    # Ensure mod_rewrite is enabled
    RewriteEngine On

    # API requests go directly to PHP files
    RewriteRule ^src/api/ - [L]

    # Don't rewrite existing files/directories
    RewriteCond %{REQUEST_FILENAME} !-f
    RewriteCond %{REQUEST_FILENAME} !-d

    # SPA fallback
    RewriteRule . /index.html [L]

    # SSL (use certbot or your certificate)
    SSLEngine on
    SSLCertificateFile /etc/letsencrypt/live/vault.yourdomain.com/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/vault.yourdomain.com/privkey.pem
</VirtualHost>
```

### Enabling mod_rewrite

```bash
sudo a2enmod rewrite
sudo systemctl restart apache2
```

---

## Generating Security Keys

Use `openssl` to generate cryptographically secure random keys:

```bash
# ENCRYPTION_KEY -- 32-byte hex (used for AES-256-GCM field encryption)
openssl rand -hex 32

# DATA_SESSION_SECRET -- 32-byte hex (used for data session tokens)
openssl rand -hex 32

# JWT_SECRET -- 64-byte hex (used for JWT signing)
openssl rand -hex 64
```

Paste the generated values into your `config/.env` file. Never commit `.env` to version control.

---

## Testing

### Start Backend and Frontend

```bash
# Terminal 1: PHP backend
php -S localhost:8081 router.php

# Terminal 2: Vite dev server (proxies API calls to backend)
npm run dev
```

The Vite dev server runs on `http://localhost:5173` and proxies all `/src/api/*` requests to `http://localhost:8081`.

### Run API Tests

```bash
python3 scripts/test_api.py
```

### Seed Test Data

```bash
npm run test:setup
```

---

## Troubleshooting

### Invalid Credentials on Login

- Verify the default admin user exists in the database:
  ```sql
  SELECT id, username, role, is_active FROM users WHERE username = 'admin123';
  ```
- Ensure `is_active` is `1`
- If the user is missing, re-run `database/schema.sql` to re-seed it
- Check that the password hash matches `Admin@123` (bcrypt cost 12)

### Column Not Found / SQL Errors

- The schema may be out of date. Re-import the latest `database/schema.sql`:
  ```bash
  mysql -u root -p citadel_vault_db < database/schema.sql
  ```
- If you cannot drop and recreate, check for missing columns and add them manually using any migration files in the `database/` directory

### Blank Page After Login

- Ensure `npm run build` was run and the `public/` directory contains `index.html` and an `assets/` folder
- Check the browser console for JavaScript errors
- Verify `VITE_API_BASE_URL` is set to `/src/api` in your `.env`
- On Apache, confirm `mod_rewrite` is enabled and `.htaccess` is in the document root
- Check that `AllowOverride All` is set in your Apache virtual host or directory config

### WebAuthn Not Working

- WebAuthn requires a **secure context** (HTTPS or `localhost`). It will not work over plain HTTP on a non-localhost domain
- Verify these `.env` settings match your actual domain:
  ```ini
  WEBAUTHN_RP_ID=yourdomain.com
  WEBAUTHN_RP_NAME=Citadel
  WEBAUTHN_ORIGIN=https://yourdomain.com
  ```
- `WEBAUTHN_RP_ID` must be the domain (no protocol, no port) -- e.g., `yourdomain.com`
- `WEBAUTHN_ORIGIN` must include the protocol -- e.g., `https://yourdomain.com`
- Ensure your browser supports WebAuthn (all modern browsers do)
- Check that the `user_credentials_webauthn` and `webauthn_challenges` tables exist in the database
