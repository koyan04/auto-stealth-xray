# Xray Server Manager

Xray Server Manager is a small self-hosted panel for the same inbound shape used by the bundled installer.

It is intentionally narrower than 3x-ui. The project focuses on ws+tls VLESS clients so the generated links and client behavior stay close to the original script.

## What it does

- nginx terminates TLS on `443`
- nginx proxies only `/assets` to `127.0.0.1:10000`
- Xray runs VLESS over WebSocket with `decryption: none`
- the panel can add, edit, delete, disable, expire, and limit users

## Requirements

- Debian or Ubuntu server
- A domain that already points to the server
- Root access for the installer

## Install from GitHub

Clone the repository from GitHub, then run the installer from the project root:

```bash
git clone https://github.com/koyan04/auto-stealth-xray.git
cd xray-server-manager
sudo bash scripts/install.sh vpn.yourdomain.com
```

If you already have the repository checked out locally, the same installer command works from that folder.

## Installer script

The installation entry point is [scripts/install.sh](scripts/install.sh). It performs the full server setup:

- installs base packages
- enables BBR
- installs and configures Xray
- installs Fail2ban
- downloads GeoIP and GeoSite data with weekly refresh
- configures nginx and TLS
- builds the web panel
- creates the systemd service

## After installation

Open the panel at:

```text
https://vpn.yourdomain.com/panel/
```

Use the generated panel token printed at the end of installation.

## User limits

The panel stores user metadata in `/etc/xray-panel/users.json`.

- Duration control: expired users are removed from the active Xray client list.
- Data control: Xray stats are read from the local Stats API using each client's `email`.
- IP control: the panel inspects recent Xray access logs and flags users over their configured IP count.

The enforcement loop runs once per minute and restarts Xray after config changes.

## Compatibility

The generated VLESS links keep the original style:

```text
type=ws&encryption=none&security=tls&path=%2Fassets&host=DOMAIN&sni=DOMAIN&fp=chrome&alpn=http%2F1.1
```

The panel does not create TCP, gRPC, Reality, Trojan, or mixed inbound types.

## Customization

The installer supports a few environment overrides if you need to change defaults:

```bash
APP_DIR=/opt/xray-server-manager \
PANEL_PORT=2053 \
WS_PATH=/assets \
sudo bash scripts/install.sh vpn.yourdomain.com
```
