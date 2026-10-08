// Synthetic test provider only. Keys are generated for each fixture; no real
// identities, credentials, browser sessions or application bypasses are used.
import type { OidcSettings } from "../src/oidc-config";

function base64url(value: Uint8Array) {
  return Buffer.from(value).toString("base64url");
}

export async function providerFixture(settings: OidcSettings) {
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const jwk = {
    ...(await crypto.subtle.exportKey("jwk", pair.publicKey)),
    kid: "synthetic-key",
    alg: "RS256",
    use: "sig",
  };
  const fixture = {
    authorization: undefined as URL | undefined,
    failure: "",
    exchanges: 0,
    pkceValid: false,
    signatureRead: false,
    accessToken: "synthetic-access-token",
    grantedScope: "openid data:read",
    async fetch(url: string, options: RequestInit): Promise<Response> {
      const path = new URL(url).pathname;
      if (path.endsWith("/.well-known/openid-configuration")) {
        if (fixture.failure === "discovery-refused")
          return Response.json({}, { status: 503 });
        return Response.json({
          issuer:
            fixture.failure === "metadata-issuer"
              ? "https://other.example.test"
              : settings.issuer,
          authorization_endpoint: `${settings.issuer}/authorize`,
          token_endpoint:
            fixture.failure === "external-endpoint"
              ? "https://other.example.test/token"
              : `${settings.issuer}/token`,
          jwks_uri: `${settings.issuer}/jwks`,
          response_types_supported: ["code"],
          subject_types_supported: ["public"],
          id_token_signing_alg_values_supported: ["RS256"],
          code_challenge_methods_supported:
            fixture.failure === "no-pkce" ? ["plain"] : ["S256"],
          authorization_response_iss_parameter_supported: true,
        });
      }
      if (path.endsWith("/jwks")) {
        fixture.signatureRead = true;
        return Response.json({ keys: [jwk] });
      }
      if (!path.endsWith("/token"))
        throw new Error("Unexpected synthetic provider request");
      fixture.exchanges += 1;
      if (fixture.failure === "exchange-refused")
        return Response.json({ error: "invalid_grant" }, { status: 400 });
      if (fixture.failure === "redirect")
        throw new TypeError("Synthetic redirect refused");
      const params = new URLSearchParams(String(options.body));
      const challenge = base64url(
        new Uint8Array(
          await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(params.get("code_verifier") ?? ""),
          ),
        ),
      );
      fixture.pkceValid =
        challenge ===
          fixture.authorization?.searchParams.get("code_challenge") &&
        params.get("grant_type") === "authorization_code" &&
        params.get("client_id") === settings.clientId &&
        params.get("redirect_uri") === settings.redirectUri &&
        !params.has("client_secret");
      if (!fixture.pkceValid)
        return Response.json({ error: "invalid_grant" }, { status: 400 });
      const now = Math.floor(Date.now() / 1000);
      const claims = {
        iss:
          fixture.failure === "id-issuer"
            ? "https://other.example.test"
            : settings.issuer,
        sub: "synthetic-subject",
        aud:
          fixture.failure === "audience" ? "other-client" : settings.clientId,
        iat: now,
        exp: fixture.failure === "expired-id" ? now - 120 : now + 300,
        auth_time:
          fixture.failure === "old-auth"
            ? now - 120
            : fixture.failure === "late-issuance"
              ? now - 61
              : now,
        nonce:
          fixture.failure === "nonce"
            ? "wrong-nonce"
            : fixture.authorization?.searchParams.get("nonce"),
      };
      const input = [
        base64url(
          new TextEncoder().encode(
            JSON.stringify({ alg: "RS256", kid: jwk.kid }),
          ),
        ),
        base64url(new TextEncoder().encode(JSON.stringify(claims))),
      ].join(".");
      const signature = new Uint8Array(
        await crypto.subtle.sign(
          "RSASSA-PKCS1-v1_5",
          pair.privateKey,
          new TextEncoder().encode(input),
        ),
      );
      if (fixture.failure === "signature")
        signature[0] = (signature[0] ?? 0) ^ 255;
      const body: Record<string, unknown> = {
        access_token: fixture.accessToken,
        token_type: "Bearer",
        scope: fixture.failure === "scope" ? "openid" : fixture.grantedScope,
        expires_in: fixture.failure === "overlong" ? 86401 : 300,
        id_token: `${input}.${base64url(signature)}`,
      };
      if (fixture.failure === "refresh" || fixture.failure === "empty-refresh")
        body.refresh_token =
          fixture.failure === "refresh" ? "synthetic-refresh-token" : "";
      if (fixture.failure === "no-id") delete body.id_token;
      if (fixture.failure === "no-expiry") delete body.expires_in;
      return Response.json(body);
    },
  };
  return fixture;
}
