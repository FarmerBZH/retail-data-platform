# Source from the repository root: source scripts/local-identity-env.sh
if [ ! -f "$PWD/.env.identity.local-certs/tls.crt" ]; then
    echo "Run this command from the repository root after starting local Keycloak." >&2
    return 1
fi

export SSL_CERT_FILE="$PWD/.env.identity.local-certs/tls.crt"
export API_ISSUER=https://localhost:8443/realms/retail
export API_AUDIENCE=retail-api
export API_JWKS_URL=https://localhost:8443/realms/retail/protocol/openid-connect/certs
export API_CLIENT_ID=retail-personal
export AUTH_AUTHORIZATION_URL=https://localhost:8443/realms/retail/protocol/openid-connect/auth
export AUTH_TOKEN_URL=https://localhost:8443/realms/retail/protocol/openid-connect/token
export AUTH_API_URL=http://127.0.0.1:8000
export AUTH_CALLBACK_PORT=8765
