#!/bin/bash
# ==============================================================================
# REMS Remote Access Tunnel (Cloudflare)
# Enables secure public HTTPS access from anywhere (Android phone / cellular)
# ==============================================================================

echo "⚡ Starting REMS Remote Access Tunnel..."
/home/pi/.local/bin/cloudflared tunnel --url http://127.0.0.1:5000
