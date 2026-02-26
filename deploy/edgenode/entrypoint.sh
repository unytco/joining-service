#!/usr/bin/env bash
set -euo pipefail

DATA_DIR="/data/joining-service"
LOG_DIR="/data/logs"
UI_DIR="/data/ui"
CONFIG_FILE="${DATA_DIR}/config.json"

# Create directories
mkdir -p "${DATA_DIR}" "${LOG_DIR}" "${UI_DIR}"

# Generate signing key on first boot if not present
SIGNING_KEY="${DATA_DIR}/signing-key.pem"
if [ ! -f "${SIGNING_KEY}" ]; then
  echo "Generating ephemeral ed25519 signing key..."
  # Generate 32 random bytes as hex (ed25519 private key seed)
  head -c 32 /dev/urandom | od -A n -t x1 | tr -d ' \n' > "${SIGNING_KEY}"
  chmod 600 "${SIGNING_KEY}"
fi

# Create default config if none exists
if [ ! -f "${CONFIG_FILE}" ]; then
  cat > "${CONFIG_FILE}" <<'DEFAULTCONFIG'
{
  "happ": {
    "id": "my-app",
    "name": "My App"
  },
  "auth_methods": ["open"],
  "linker_urls": ["wss://linker.example.com:8090"],
  "membrane_proof": {
    "enabled": true,
    "signing_key_path": "/data/joining-service/signing-key.pem"
  },
  "session": {
    "store": "sqlite",
    "db_path": "/data/joining-service/sessions.db"
  },
  "reconnect": {
    "enabled": true
  }
}
DEFAULTCONFIG
  echo "Created default config at ${CONFIG_FILE} — edit before production use."
fi

# Ensure correct ownership
chown -R nonroot:nonroot /data

# Start the joining service in the background as nonroot
echo "Starting joining service..."
cd /opt/joining-service
gosu nonroot node dist/server.js "${CONFIG_FILE}" > "${LOG_DIR}/joining-service.log" 2>&1 &
JS_PID=$!

# Start nginx in the foreground
echo "Starting nginx on port 8080..."
exec nginx -g 'daemon off;'
