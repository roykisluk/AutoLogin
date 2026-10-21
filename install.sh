#!/bin/sh
# Registers host.py as the native messaging host for the unpacked extension in this folder.
# Brave reads user-level hosts from *Chrome's* folder, not its own (tested 2026-10-21).
set -e
DIR=$(cd "$(dirname "$0")" && pwd)
ID=$(printf %s "$DIR/extension" | shasum -a 256 | head -c 32 | tr 0-9a-f a-p)  # unpacked extension ID
OUT="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
mkdir -p "$OUT"
cat > "$OUT/com.roykisluk.autologin.json" <<EOF
{
  "name": "com.roykisluk.autologin",
  "description": "AutoLogin helper",
  "path": "$DIR/host.py",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$ID/"]
}
EOF
chmod +x "$DIR/host.py"
echo "registered host for extension $ID"
