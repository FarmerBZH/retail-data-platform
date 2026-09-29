#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
config_file="$project_dir/.env.identity.local"
cert_dir="$project_dir/.env.identity.local-certs"

if [ -e "$config_file" ] || [ -e "$cert_dir" ]; then
    echo "Local identity files already exist; refusing to replace them." >&2
    exit 1
fi

umask 077
mkdir "$cert_dir"

openssl req -x509 -newkey rsa:3072 -sha256 -noenc \
    -keyout "$cert_dir/tls.key" -out "$cert_dir/tls.crt" -days 365 \
    -subj "/CN=localhost" \
    -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" \
    -addext "basicConstraints=critical,CA:FALSE" \
    -addext "extendedKeyUsage=serverAuth" >/dev/null 2>&1

database_password=$(openssl rand -hex 32)
admin_password=$(openssl rand -hex 32)
cat >"$config_file" <<EOF
POSTGRES_PASSWORD=$database_password
KC_DB_USERNAME=keycloak
KC_DB_PASSWORD=$database_password
KC_BOOTSTRAP_ADMIN_USERNAME=local-admin
KC_BOOTSTRAP_ADMIN_PASSWORD=$admin_password
EOF
chmod 600 "$config_file" "$cert_dir/tls.key"

echo "Generated local identity credentials and a localhost TLS certificate."
echo "The generated files are ignored by Git; keep them private."
