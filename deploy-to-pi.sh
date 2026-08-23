#!/bin/bash

# ==============================================================================
# REMS - Raspberry Pi Setup & Deployment Script (Flask Monolithic)
# This script installs the necessary tech stack (Python)
# and prepares the Flask server.
# ==============================================================================

echo "⚡ Starting REMS Deployment to Raspberry Pi..."

# 1. Update system packages
echo "📦 Updating system packages..."
sudo apt update && sudo apt upgrade -y

# 2. Install Python 3, pip, and venv for the Flask Backend
echo "🐍 Setting up Python for Flask Backend..."
sudo apt install -y python3 python3-pip python3-venv

# Create virtual environment for backend if it doesn't exist
if [ ! -d "backend/venv" ]; then
    echo "📦 Creating Python virtual environment in backend/venv..."
    python3 -m venv backend/venv
fi

# Install backend requirements
echo "📦 Installing Flask backend requirements..."
backend/venv/bin/pip install -r backend/requirements.txt

# Get Raspberry Pi IP Address
PI_IP=$(hostname -I | awk '{print $1}')
echo "======================================================"
echo "✅ Deployment Setup Successful!"
echo ""
echo "🐍 Para paandarin ang buong system (UI at ESP32 receiver), i-type ito:"
echo "cd backend"
echo "source venv/bin/activate"
echo "python app.py"
echo ""
echo "🔌 Kapag tumatakbo na, maa-access mo ang REMS Dashboard at Login sa:"
echo "👉 http://$PI_IP:5000"
echo "======================================================"
