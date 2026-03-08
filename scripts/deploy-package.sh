#!/bin/bash
# deploy-package.sh — Build and package for deployment.
# Creates a deploy-ready zip with only server files (no node_modules, no source).
# Usage: bash scripts/deploy-package.sh

set -e
cd "$(dirname "$0")/.."

echo "Building frontend..."
npm run build

VERSION=$(node -e "console.log(require('./package.json').version)")
BUILD=$(cat .build-number 2>/dev/null || echo "0")
DATE=$(date +%Y%m%d)
FILENAME="citadel_vault_v${VERSION}_${DATE}.${BUILD}.zip"

echo "Packaging: $FILENAME"

# Create zip with only deployable files
zip -r "$FILENAME" \
  config/.env.example \
  config/config.php \
  config/database.php \
  database/schema.sql \
  deploy/.htaccess \
  public/ \
  router.php \
  src/api/ \
  src/core/ \
  -x "*.DS_Store"

SIZE=$(du -h "$FILENAME" | cut -f1)
echo ""
echo "Done: $FILENAME ($SIZE)"
echo ""
echo "Deploy steps:"
echo "  1. Upload and unzip on server"
echo "  2. Copy config/.env.example to config/.env and edit"
echo "  3. Import database: mysql -u USER -p DB < database/schema.sql"
echo "  4. Point web root to public/ (Apache/Nginx)"
echo "  5. For Apache: copy deploy/.htaccess to project root"
