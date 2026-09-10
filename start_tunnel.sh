#!/bin/bash
# ==============================================================================
# REMS Remote Access Tunnel (Cloudflare)
# Enables secure public HTTPS access from anywhere (Android phone / cellular)
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
URL_FILE="$SCRIPT_DIR/backend/latest_tunnel_url.txt"
LOG_FILE="/tmp/cloudflared_rems.log"

echo "⚡ Starting REMS Remote Access Tunnel..."

# 1. Locate or auto-download cloudflared
CLOUDFLARED_BIN=""
if command -v cloudflared &>/dev/null; then
    CLOUDFLARED_BIN="$(command -v cloudflared)"
elif [ -x "$HOME/.local/bin/cloudflared" ]; then
    CLOUDFLARED_BIN="$HOME/.local/bin/cloudflared"
elif [ -x "/usr/local/bin/cloudflared" ]; then
    CLOUDFLARED_BIN="/usr/local/bin/cloudflared"
fi

if [ -z "$CLOUDFLARED_BIN" ]; then
    echo "📦 cloudflared not found. Auto-downloading binary for $(uname -m)..."
    mkdir -p "$HOME/.local/bin"
    ARCH=$(uname -m)
    if [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then
        DOWNLOAD_URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64"
    elif [ "$ARCH" = "armv7l" ]; then
        DOWNLOAD_URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm"
    else
        DOWNLOAD_URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64"
    fi

    curl -sL --output "$HOME/.local/bin/cloudflared" "$DOWNLOAD_URL"
    chmod +x "$HOME/.local/bin/cloudflared"
    CLOUDFLARED_BIN="$HOME/.local/bin/cloudflared"
    echo "✅ Installed cloudflared to $CLOUDFLARED_BIN"
fi

# 2. Check if Named Tunnel Token is provided in environment or .env
if [ -n "$CLOUDFLARE_TUNNEL_TOKEN" ]; then
    echo "🔒 Launching Named Cloudflare Tunnel with provided token..."
    exec "$CLOUDFLARED_BIN" tunnel run --token "$CLOUDFLARE_TUNNEL_TOKEN"
fi

# 3. Launch Free Quick Tunnel
echo "🌐 Launching Cloudflare Quick Tunnel to http://127.0.0.1:5000..."
rm -f "$LOG_FILE"
"$CLOUDFLARED_BIN" tunnel --url http://127.0.0.1:5000 > "$LOG_FILE" 2>&1 &
TUNNEL_PID=$!

# Trap cleanup on exit
cleanup() {
    echo ""
    echo "🛑 Shutting down Cloudflare Tunnel (PID $TUNNEL_PID)..."
    kill "$TUNNEL_PID" 2>/dev/null
    rm -f "$URL_FILE"
    exit 0
}
trap cleanup SIGINT SIGTERM EXIT

# 4. Wait for and extract the generated trycloudflare.com URL
echo "⏳ Waiting for Cloudflare to assign a public HTTPS domain..."
TUNNEL_URL=""
for i in {1..30}; do
    sleep 1
    if [ -f "$LOG_FILE" ]; then
        TUNNEL_URL=$(grep -o 'https://[a-zA-Z0-9.-]*\.trycloudflare\.com' "$LOG_FILE" | head -n 1)
        if [ -n "$TUNNEL_URL" ]; then
            break
        fi
    fi
done

if [ -n "$TUNNEL_URL" ]; then
    echo "$TUNNEL_URL" > "$URL_FILE"
    echo ""
    echo "========================================================================"
    echo "  ⚡ REMS CLOUDFLARE TUNNEL ONLINE! ⚡"
    echo "========================================================================"
    echo ""
    echo "  👉 Public URL:   $TUNNEL_URL"
    echo "  👉 Mobile App:   $TUNNEL_URL/mobile"
    echo ""
    echo "  📱 Enter this URL in your REMS Android App:"
    echo "     $TUNNEL_URL"
    echo ""
    echo "========================================================================"
    echo "  (Press Ctrl+C to stop the tunnel)"
    echo "========================================================================"
else
    echo "⚠️ Could not auto-detect tunnel URL within 30s. Checking logs:"
    cat "$LOG_FILE"
fi

# Keep script running to keep tunnel alive
wait "$TUNNEL_PID"
