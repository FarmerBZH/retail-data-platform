import * as oauth from "oauth4webapi";
import { CALLBACK_PATH, secureUrl } from "./oidc-config";
import type { OidcSettings } from "./oidc-config";
import { Session } from "./session";
import type { SessionOperation } from "./session";

export const REDIRECT_KEY = "oidc.redirect";
export const REDIRECT_TTL = 10 * 60 * 1000;
type RedirectState = { state: string; nonce: string; verifier: string };

// Capture and erase before React renders or an exchange starts. Never log this URL.
export function captureCallback(
  location: Location,
  history: History,
): URL | undefined {
  if (location.pathname !== CALLBACK_PATH) return;
  const callback = new URL(location.href);
  history.replaceState(null, "", "/");
  return callback;
}

export class Authentication {
  readonly sessions = new Session();
  #busy: SessionOperation | undefined;
  #leavingForProvider = false;
  readonly #client: oauth.Client;
  readonly #issuer: URL;
  readonly #options;

  constructor(
    readonly settings: OidcSettings,
    readonly storage: Storage,
    readonly navigate: (url: string) => void,
  ) {
    this.#issuer = new URL(settings.issuer);
    this.#client = {
      client_id: settings.clientId,
      id_token_signed_response_alg: "RS256",
      require_auth_time: true,
      [oauth.clockTolerance]: 60,
    };
    this.#options = {
      [oauth.allowInsecureRequests]: this.#issuer.protocol === "http:",
      [oauth.customFetch]: async (
        url: string,
        options: oauth.CustomFetchOptions<
          "GET" | "POST",
          URLSearchParams | undefined
        >,
      ) => {
        const destination = secureUrl(url);
        if (!destination || destination.origin !== this.#issuer.origin)
          throw new Error("Sign-in unavailable");
        const { body, signal, ...rest } = options;
        signal?.throwIfAborted();
        return fetch(url, {
          ...rest,
          ...(body === undefined ? {} : { body }),
          ...(signal === undefined ? {} : { signal }),
          redirect: "error",
          credentials: "omit",
          cache: "no-store",
          referrerPolicy: "no-referrer",
        });
      },
      signal: () => AbortSignal.timeout(10_000),
    };
    this.expireRedirect();
  }

  get session() {
    return this.sessions.credentials;
  }

  logout(): void {
    this.#leavingForProvider = false;
    this.#busy = undefined;
    this.sessions.end();
    this.#clearRedirect();
  }

  leaveDocument(): void {
    const preserveRedirect = this.#leavingForProvider;
    this.#leavingForProvider = false;
    this.#busy = undefined;
    this.sessions.end();
    if (!preserveRedirect) this.#clearRedirect();
  }

  #clearRedirect(): void {
    try {
      this.storage.removeItem(REDIRECT_KEY);
    } catch {
      // Ending memory authority must succeed even if browser storage is blocked.
    }
  }

  #assertCurrent(operation: SessionOperation): void {
    if (!operation.isCurrent()) throw new Error("Sign-in unavailable");
  }

  #requestOptions(operation: SessionOperation) {
    return {
      ...this.#options,
      signal: () =>
        AbortSignal.any([operation.signal, AbortSignal.timeout(10_000)]),
    };
  }

  // A state is bound to this issuer/client/callback without storing extra metadata.
  async #binding(): Promise<string> {
    const data = new TextEncoder().encode(
      JSON.stringify([
        this.settings.issuer,
        this.settings.clientId,
        this.settings.redirectUri,
      ]),
    );
    const digest = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
  }

  #readRedirect(): RedirectState | undefined {
    const raw = this.storage.getItem(REDIRECT_KEY);
    if (!raw) return;
    try {
      const value: unknown = JSON.parse(raw);
      if (!value || typeof value !== "object") return;
      const record = value as Record<string, unknown>;
      if (Object.keys(record).sort().join(",") !== "nonce,state,verifier")
        return;
      if (
        typeof record.state !== "string" ||
        typeof record.nonce !== "string" ||
        typeof record.verifier !== "string"
      )
        return;
      if (
        !/^\d{13}\.[a-f0-9]{64}\.[A-Za-z0-9_-]{43}$/.test(record.state) ||
        !/^[A-Za-z0-9_-]{43}$/.test(record.nonce) ||
        !/^[A-Za-z0-9_-]{43}$/.test(record.verifier)
      )
        return;
      const created = Number(record.state.split(".")[0]);
      if (created > Date.now() || Date.now() - created >= REDIRECT_TTL) return;
      return {
        state: record.state,
        nonce: record.nonce,
        verifier: record.verifier,
      };
    } catch {
      return;
    }
  }

  expireRedirect(): void {
    if (!this.#readRedirect()) this.storage.removeItem(REDIRECT_KEY);
  }

  async #server(
    operation: SessionOperation,
  ): Promise<oauth.AuthorizationServer> {
    const response = await oauth.discoveryRequest(
      this.#issuer,
      this.#requestOptions(operation),
    );
    const server = await oauth.processDiscoveryResponse(this.#issuer, response);
    for (const key of [
      "authorization_endpoint",
      "token_endpoint",
      "jwks_uri",
    ] as const) {
      const url = secureUrl(server[key]);
      if (!url || url.origin !== this.#issuer.origin)
        throw new Error("Sign-in unavailable");
    }
    if (!server.code_challenge_methods_supported?.includes("S256"))
      throw new Error("Sign-in unavailable");
    return server;
  }

  async signIn(): Promise<void> {
    if (this.#busy) return;
    const operation = this.sessions.begin();
    this.#busy = operation;
    this.#leavingForProvider = false;
    try {
      this.storage.removeItem(REDIRECT_KEY);
      const server = await this.#server(operation);
      this.#assertCurrent(operation);
      const verifier = oauth.generateRandomCodeVerifier();
      const nonce = oauth.generateRandomNonce();
      const state = `${Date.now()}.${await this.#binding()}.${oauth.generateRandomState()}`;
      const url = new URL(server.authorization_endpoint!);
      url.search = new URLSearchParams({
        client_id: this.settings.clientId,
        redirect_uri: this.settings.redirectUri,
        response_type: "code",
        scope: "openid data:read",
        prompt: "login",
        max_age: "0",
        code_challenge_method: "S256",
        code_challenge: await oauth.calculatePKCECodeChallenge(verifier),
        state,
        nonce,
      }).toString();
      this.#assertCurrent(operation);
      this.storage.setItem(
        REDIRECT_KEY,
        JSON.stringify({ state, nonce, verifier }),
      );
      this.#leavingForProvider = true;
      this.navigate(url.href);
    } catch {
      if (operation.isCurrent()) {
        this.#leavingForProvider = false;
        this.#clearRedirect();
        this.sessions.end("error");
      }
      throw new Error("Sign-in unavailable");
    } finally {
      if (this.#busy === operation) this.#busy = undefined;
    }
  }

  async complete(callback: URL): Promise<void> {
    if (this.#busy) throw new Error("Sign-in unavailable");
    const operation = this.sessions.begin();
    this.#busy = operation;
    this.#leavingForProvider = false;
    try {
      const transaction = this.#readRedirect();
      // Consume before any asynchronous operation: callbacks cannot be replayed.
      this.storage.removeItem(REDIRECT_KEY);
      if (
        !transaction ||
        callback.origin + callback.pathname !== this.settings.redirectUri ||
        callback.hash ||
        callback.searchParams.getAll("iss").length !== 1 ||
        callback.searchParams.get("iss") !== this.settings.issuer ||
        transaction.state.split(".")[1] !== (await this.#binding())
      )
        throw new Error("Sign-in unavailable");
      const server = await this.#server(operation);
      this.#assertCurrent(operation);
      const params = oauth.validateAuthResponse(
        server,
        this.#client,
        callback,
        transaction.state,
      );
      const exchangedAt = Date.now();
      const response = await oauth.authorizationCodeGrantRequest(
        server,
        this.#client,
        oauth.None(),
        params,
        this.settings.redirectUri,
        transaction.verifier,
        this.#requestOptions(operation),
      );
      this.#assertCurrent(operation);
      const result = await oauth.processAuthorizationCodeResponse(
        server,
        this.#client,
        response,
        {
          expectedNonce: transaction.nonce,
          maxAge: 0,
          requireIdToken: true,
        },
      );
      if (
        Object.hasOwn(result, "refresh_token") ||
        result.token_type !== "bearer" ||
        !Number.isSafeInteger(result.expires_in) ||
        !result.expires_in ||
        result.expires_in <= 0 ||
        result.expires_in > 86400 ||
        !result.scope?.split(" ").includes("data:read")
      )
        throw new Error("Sign-in unavailable");
      await oauth.validateApplicationLevelSignature(
        server,
        response,
        this.#requestOptions(operation),
      );
      const claims = oauth.getValidatedIdTokenClaims(result);
      if (
        !claims ||
        !Number.isSafeInteger(claims.auth_time) ||
        !claims.auth_time ||
        claims.iat < claims.auth_time ||
        claims.iat - claims.auth_time > 60
      )
        throw new Error("Sign-in unavailable");
      const expiresAt = Math.min(
        exchangedAt + result.expires_in * 1000,
        (claims.auth_time + 86400) * 1000,
      );
      if (expiresAt <= Date.now()) throw new Error("Sign-in unavailable");
      this.#assertCurrent(operation);
      if (
        !this.sessions.accept(operation, {
          accessToken: result.access_token,
          expiresAt,
        })
      )
        throw new Error("Sign-in unavailable");
    } catch {
      if (operation.isCurrent()) this.sessions.end("error");
      throw new Error("Sign-in unavailable");
    } finally {
      if (this.#busy === operation) this.#busy = undefined;
    }
  }
}
