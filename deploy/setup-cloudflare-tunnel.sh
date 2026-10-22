#!/bin/bash
# ==============================================================================
# REMS - Permanent Cloudflare Named Tunnel Setup (run ON the Raspberry Pi)
#
# Installs:
#   1. cloudflared (from Cloudflare's official apt repo) as a systemd service
#      using the tunnel token from the Cloudflare Zero Trust dashboard
#   2. rems.service - runs the Flask backend on boot and restarts it on crash
#
# Usage:
#   ./deploy/setup-cloudflare-tunnel.sh                # prompts for token + URL
#   CLOUDFLARE_TUNNEL_TOKEN=eyJ... REMS_PUBLIC_URL=https://rems.example.xyz ./deploy/setup-cloudflare-tunnel.sh
#
# See docs/CLOUDFLARE_TUNNEL.md for the dashboard steps that produce the token.
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"
BACKEND_DIR="$REPO_DIR/backend"
ENV_FILE="$BACKEND_DIR/.env"
RUN_USER="${SUDO_USER:-$USER}"

echo "⚡ REMS Cloudflare Named Tunnel Setup"
echo "   Repo:    $REPO_DIR"
echo "   Run as:  $RUN_USER"
echo ""

# Read a KEY=value from backend/.env without sourcing the whole file
read_env() {
    [ -f "$ENV_FILE" ] && grep -E "^$1=" "$ENV_FILE" | tail -n 1 | cut -d= -f2- | tr -d '"'"'" || true
}

# Insert or replace KEY=value in backend/.env
write_env() {
    touch "$ENV_FILE"
    chmod 600 "$ENV_FILE"
    if grep -qE "^$1=" "$ENV_FILE"; then
        sed -i "s|^$1=.*|$1=$2|" "$ENV_FILE"
    else
        echo "$1=$2" >> "$ENV_FILE"
    fi
}

# ------------------------------------------------------------------------------
# 1. Collect tunnel token and public URL
# ------------------------------------------------------------------------------
TOKEN="${CLOUDFLARE_TUNNEL_TOKEN:-$(read_env CLOUDFLARE_TUNNEL_TOKEN)}"
if [ -z "$TOKEN" ]; then
    echo "Paste the tunnel token from Cloudflare Zero Trust → Networks → Tunnels"
    echo "(the long string after '--token' in the install command):"
    read -r -s TOKEN
    echo ""
fi
# Accept a full pasted install command as well as the bare token
TOKEN="$(echo "$TOKEN" | grep -oE 'eyJ[A-Za-z0-9+/_=-]+' | head -n 1 || true)"
if [ -z "$TOKEN" ]; then
    echo "❌ No valid tunnel token found (it should start with 'eyJ')."
    exit 1
fi

PUBLIC_URL="${REMS_PUBLIC_URL:-$(read_env REMS_PUBLIC_URL)}"
if [ -z "$PUBLIC_URL" ]; then
    read -r -p "Public hostname you configured (e.g. https://rems.example.xyz): " PUBLIC_URL
fi
PUBLIC_URL="${PUBLIC_URL%/}"
if [[ "$PUBLIC_URL" != https://* ]]; then
    PUBLIC_URL="https://${PUBLIC_URL#http://}"
fi

write_env CLOUDFLARE_TUNNEL_TOKEN "$TOKEN"
write_env REMS_PUBLIC_URL "$PUBLIC_URL"
echo "✅ Saved token and public URL to backend/.env (chmod 600)"

# ------------------------------------------------------------------------------
# 2. Install cloudflared from Cloudflare's apt repository
# ------------------------------------------------------------------------------
if ! command -v cloudflared &>/dev/null; then
    echo "📦 Installing cloudflared..."
    sudo mkdir -p --mode=0755 /usr/share/keyrings
    curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
    echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main" \
        | sudo tee /etc/apt/sources.list.d/cloudflared.list >/dev/null
    sudo apt-get update
    sudo apt-get install -y cloudflared
fi
echo "✅ $(cloudflared --version)"

# ------------------------------------------------------------------------------
# 3. Register the tunnel as a systemd service (starts on boot)
# ------------------------------------------------------------------------------
if [ -f /etc/systemd/system/cloudflared.service ]; then
    echo "♻️  Replacing existing cloudflared service..."
    sudo cloudflared service uninstall || true
fi
sudo cloudflared service install "$TOKEN"
sudo systemctl enable --now cloudflared
echo "✅ cloudflared service installed and running"

# ------------------------------------------------------------------------------
# 4. Install rems.service for the Flask backend
# ------------------------------------------------------------------------------
PYTHON_BIN="$BACKEND_DIR/venv/bin/python"
if [ ! -x "$PYTHON_BIN" ]; then
    echo "⚠️  $PYTHON_BIN not found. Run ./deploy-to-pi.sh first to create the venv."
    exit 1
fi

sudo tee /etc/systemd/system/rems.service >/dev/null <<EOF
[Unit]
Description=REMS Flask Backend (dashboard, relays, sensors)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$RUN_USER
SupplementaryGroups=gpio dialout
WorkingDirectory=$BACKEND_DIR
ExecStart="$PYTHON_BIN" app.py
Restart=always
RestartSec=5
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now rems
echo "✅ rems.service installed and running"

# ------------------------------------------------------------------------------
# 5. Verify
# ------------------------------------------------------------------------------
echo ""
echo "⏳ Checking local server and public URL..."
sleep 5
LOCAL_CODE=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:5000/mobile || echo "000")
PUBLIC_CODE=$(curl -s -o /dev/null -w '%{http_code}' "$PUBLIC_URL/mobile" || echo "000")
echo "   Local  http://127.0.0.1:5000/mobile → HTTP $LOCAL_CODE"
echo "   Public $PUBLIC_URL/mobile → HTTP $PUBLIC_CODE"

echo ""
echo "========================================================================"
if [ "$PUBLIC_CODE" = "200" ] || [ "$PUBLIC_CODE" = "302" ]; then
    echo "  ⚡ REMS IS ONLINE: $PUBLIC_URL"
else
    echo "  ⚠️  Public URL not reachable yet. It can take a minute after setup."
    echo "     Check: sudo journalctl -u cloudflared -n 50"
    echo "     Check the Public Hostname points to HTTP localhost:5000"
fi
echo ""
echo "  📱 Enter this URL once in the REMS Android app:"
echo "     $PUBLIC_URL"
echo ""
echo "  Logs:  sudo journalctl -u rems -f"
echo "         sudo journalctl -u cloudflared -f"
echo "========================================================================"
