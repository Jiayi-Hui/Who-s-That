#!/usr/bin/env bash
set -euo pipefail

rm -rf dist
mkdir -p dist
cp -R frontend/. dist/

API_BASE_URL="${WHOS_THAT_API_BASE_URL:-}"
cat > dist/config.js <<EOF
window.WHOS_THAT_API_BASE_URL = "${API_BASE_URL}";
EOF

