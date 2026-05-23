#!/bin/bash

# [0] Root Permission စစ်ဆေးခြင်း
if [ "$EUID" -ne 0 ]; then
  echo "Error: ဤ Script ကို Root user (sudo) ဖြင့်သာ run ရပါမည်။"
  exit 1
fi

# [0.1] Domain Name တောင်းခြင်း (Argument မပါလာပါက တောင်းမည်)
if [ -z "$1" ]; then
    echo -n "ကျေးဇူးပြု၍ သင်၏ Domain Name ကို ရိုက်ထည့်ပါ (ဥပမာ - vpn.yourdomain.com): "
    read DOMAIN < /dev/tty
else
    DOMAIN=$1
fi

# Domain မဖြည့်ခဲ့ပါက ပိတ်ပစ်မည်
if [ -z "$DOMAIN" ]; then
    echo "Error: Domain Name မရှိဘဲ ဆက်လုပ်၍မရပါ။"
    exit 1
fi

# UUID ကို Auto Generate လုပ်ခြင်း
UUID=$(cat /proc/sys/kernel/random/uuid)

set -e

echo "[1] Install packages..."
apt update -y
apt install nginx certbot curl -y

echo "[2] Fake site..."
mkdir -p /var/www/html
cat > /var/www/html/index.html <<EOF
<!DOCTYPE html>
<html>
<head><title>Teamsanji</title></head>
<body>
<h1>Welcome to Teamsanji</h1>
<p>This website is under maintenance.</p>
</body>
</html>
EOF

echo "[3] Start nginx on :80 only (for ACME)..."
cat > /etc/nginx/sites-enabled/default <<EOF
server {
    listen 80;
    server_name $DOMAIN;

    root /var/www/html;
    index index.html;

    location / {
        try_files \$uri \$uri/ =404;
    }
}
EOF

systemctl restart nginx

echo "[4] Get SSL cert (standalone)..."
systemctl stop nginx
certbot delete --cert-name $DOMAIN || true
certbot certonly --standalone -d $DOMAIN --non-interactive --agree-tos -m admin@$DOMAIN || true
systemctl start nginx

echo "[5] Install Xray..."
bash <(curl -Ls https://raw.githubusercontent.com/XTLS/Xray-install/main/install-release.sh)

bash <(curl -Ls https://raw.githubusercontent.com/mhsanaei/3x-ui/master/install.sh)
x-ui setting -port 2053
x-ui setting -username vchanneladmin
x-ui setting -password Promote!23.v2R@y


echo "[6] Write FINAL nginx 443 TLS config (your style)..."
cat > /etc/nginx/sites-enabled/default <<EOF
server {
    listen 443 ssl;
    server_name $DOMAIN;
    
    ssl_certificate /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;

    root /var/www/html;
    index index.html;

    location / {
        try_files \$uri \$uri/ =404;
    }

    location /assets {
        proxy_pass http://127.0.0.1:10000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
    }
}
EOF

systemctl restart nginx

x-ui restart
echo "Installation completed successfully!"
echo "Your Domain: $DOMAIN"
echo "Your UUID: $UUID"
echo "Admin Panel: http://$DOMAIN:2053"
echo "Username: vchanneladmin"
echo "Password: Promote!23.v2R@y"