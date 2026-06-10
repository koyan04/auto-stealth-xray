#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root: sudo bash scripts/install.sh your.domain.com"
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
PANEL_TOKEN="${PANEL_TOKEN:-$(tr -d '-' </proc/sys/kernel/random/uuid)}"
FIRST_UUID="$(tr -d '-' </proc/sys/kernel/random/uuid)"

echo "[1] Install base packages"
apt update -y
apt install -y ca-certificates curl nginx certbot fail2ban rsync
if ! command -v node >/dev/null || [[ "$(node -p 'Number(process.versions.node.split(`.`)[0])')" -lt 18 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt install -y nodejs
fi

echo "[2] Enable BBR"
cat >/etc/sysctl.d/99-xray-manager-bbr.conf <<EOF
net.core.default_qdisc=fq
net.ipv4.tcp_congestion_control=bbr
EOF
sysctl --system >/dev/null

echo "[3] Create fake web root"
mkdir -p /var/www/html
cat >/var/www/html/index.html <<EOF
<!DOCTYPE html>
<html>
<head><title>Teamsanji</title></head>
<body>
<h1>Welcome to Teamsanji</h1>
<p>This website is under maintenance.</p>
</body>
</html>
EOF

echo "[4] Prepare nginx for ACME"
cat >/etc/nginx/sites-enabled/default <<EOF
server {
    listen 80;
    server_name ${DOMAIN};

    root /var/www/html;
    index index.html;

    location / {
        try_files \$uri \$uri/ =404;
    }
}
EOF
systemctl restart nginx

echo "[5] Issue TLS certificate"
systemctl stop nginx
certbot certonly --standalone -d "${DOMAIN}" --non-interactive --agree-tos -m "admin@${DOMAIN}" || true
systemctl start nginx

echo "[6] Install Xray"
bash <(curl -Ls https://raw.githubusercontent.com/XTLS/Xray-install/main/install-release.sh)
mkdir -p /var/log/xray /etc/xray-panel
chown nobody:nogroup /var/log/xray || true

echo "[7] Install GeoIP and GeoSite data"
mkdir -p /usr/local/share/xray
curl -L --fail -o /usr/local/share/xray/geoip.dat https://github.com/Loyalsoldier/v2ray-rules-dat/releases/latest/download/geoip.dat
curl -L --fail -o /usr/local/share/xray/geosite.dat https://github.com/Loyalsoldier/v2ray-rules-dat/releases/latest/download/geosite.dat
cat >/etc/cron.weekly/xray-manager-geo-update <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
curl -L --fail -o /usr/local/share/xray/geoip.dat https://github.com/Loyalsoldier/v2ray-rules-dat/releases/latest/download/geoip.dat
curl -L --fail -o /usr/local/share/xray/geosite.dat https://github.com/Loyalsoldier/v2ray-rules-dat/releases/latest/download/geosite.dat
systemctl restart xray || true
EOF
chmod +x /etc/cron.weekly/xray-manager-geo-update

echo "[8] Write initial Xray ws inbound"
cat >/usr/local/etc/xray/config.json <<EOF
{
  "log": {
    "access": "/var/log/xray/access.log",
    "loglevel": "warning"
  },
  "inbounds": [
    {
      "port": 10000,
      "protocol": "vless",
      "settings": {
        "clients": [
          {
            "id": "${FIRST_UUID}",
            "email": "initial"
          }
        ],
        "decryption": "none"
      },
      "streamSettings": {
        "network": "ws",
        "wsSettings": {
          "path": "${WS_PATH}"
        }
      }
    },
    {
      "tag": "api",
      "listen": "127.0.0.1",
      "port": 10085,
      "protocol": "dokodemo-door",
      "settings": {
        "address": "127.0.0.1"
      }
    }
  ],
  "outbounds": [
    {
      "protocol": "freedom"
    },
    {
      "protocol": "freedom",
      "tag": "api"
    }
  ],
  "api": {
    "tag": "api",
    "services": [
      "StatsService"
    ]
  },
  "policy": {
    "levels": {
      "0": {
        "statsUserUplink": true,
        "statsUserDownlink": true
      }
    },
    "system": {
      "statsInboundUplink": true,
      "statsInboundDownlink": true
    }
  },
  "routing": {
    "rules": [
      {
        "type": "field",
        "inboundTag": [
          "api"
        ],
        "outboundTag": "api"
      }
    ]
  }
}
EOF
systemctl restart xray

echo "[9] Install web panel"
mkdir -p "${APP_DIR}"
rsync -a --delete --exclude node_modules --exclude .git ./ "${APP_DIR}/"
cd "${APP_DIR}"
npm install
VITE_BASE_PATH=/panel/ npm run build
cat >"${APP_DIR}/.env" <<EOF
DOMAIN=${DOMAIN}
PANEL_PORT=${PANEL_PORT}
PANEL_TOKEN=${PANEL_TOKEN}
WS_PATH=${WS_PATH}
XRAY_CONFIG_PATH=/usr/local/etc/xray/config.json
PANEL_DB_PATH=/etc/xray-panel/users.json
XRAY_ACCESS_LOG=/var/log/xray/access.log
EOF

cat >/etc/xray-panel/users.json <<EOF
{
  "users": [
    {
      "id": "initial",
      "uuid": "${FIRST_UUID}",
      "name": "initial",
      "enabled": true,
      "dataLimitGb": 0,
      "ipLimit": 0,
      "expiresAt": "",
      "note": "Created during installation",
      "createdAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
      "updatedAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
    }
  ],
  "events": []
}
EOF

cat >/etc/systemd/system/xray-manager.service <<EOF
[Unit]
Description=Xray Server Manager
After=network.target xray.service

[Service]
Type=simple
WorkingDirectory=${APP_DIR}
EnvironmentFile=${APP_DIR}/.env
ExecStart=/usr/bin/node ${APP_DIR}/server/index.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now xray-manager

echo "[10] Configure nginx TLS, ws inbound, and panel proxy"
cat >/etc/nginx/sites-enabled/default <<EOF
server {
    listen 80;
    server_name ${DOMAIN};
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl;
    server_name ${DOMAIN};

    ssl_certificate /etc/letsencrypt/live/${DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${DOMAIN}/privkey.pem;

    root /var/www/html;
    index index.html;

    location / {
        try_files \$uri \$uri/ =404;
    }

    location ${WS_PATH} {
        proxy_pass http://127.0.0.1:10000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
    }

    location /panel/ {
        proxy_pass http://127.0.0.1:${PANEL_PORT}/;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF
nginx -t
systemctl restart nginx

echo "[11] Configure Fail2ban"
cat >/etc/fail2ban/jail.d/xray-manager.conf <<EOF
[sshd]
enabled = true

[nginx-http-auth]
enabled = true

EOF
systemctl enable --now fail2ban
systemctl restart fail2ban

echo ""
echo "=========================================================="
echo " Xray Server Manager installed"
echo "=========================================================="
echo "Panel: https://${DOMAIN}/panel/"
echo "Panel token: ${PANEL_TOKEN}"
echo "Domain: ${DOMAIN}"
echo "UUID: ${FIRST_UUID}"
echo "VLESS link:"
echo "vless://${FIRST_UUID}@${DOMAIN}:443?type=ws&encryption=none&security=tls&path=%2Fassets&host=${DOMAIN}&sni=${DOMAIN}&fp=chrome&alpn=http%2F1.1#${DOMAIN}"
echo "=========================================================="
