#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root: sudo bash scripts/update.sh your.domain.com"
  exit 1
fi

DOMAIN="${1:-}"
if [[ -z "${DOMAIN}" ]]; then
  read -rp "Domain name, for example vpn.yourdomain.com: " DOMAIN
fi

if [[ -z "${DOMAIN}" ]]; then
  echo "Domain is required."
  exit 1
fi

APP_DIR="${APP_DIR:-/opt/xray-server-manager}"
PANEL_PORT="${PANEL_PORT:-2053}"
WS_PATH="${WS_PATH:-/assets}"

echo "[1] Sync application files"
mkdir -p "${APP_DIR}"
rsync -a --delete --exclude node_modules --exclude .git --exclude .env ./ "${APP_DIR}/"

cd "${APP_DIR}"
npm install
VITE_BASE_PATH=/panel/ npm run build

echo "[2] Restart services"
systemctl daemon-reload
systemctl enable xray nginx fail2ban xray-manager
systemctl restart xray-manager
systemctl restart xray
systemctl restart nginx
systemctl restart fail2ban

echo ""
echo "=========================================================="
echo " Xray Server Manager updated"
echo "=========================================================="
echo "Panel: https://${DOMAIN}/panel/"
echo "App dir: ${APP_DIR}"
echo "=========================================================="