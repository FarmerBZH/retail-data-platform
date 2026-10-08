// @vitest-environment node
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { Authentication, REDIRECT_KEY, REDIRECT_TTL } from "./authentication";
import { providerFixture } from "../test/oidc-provider";

class MemoryStorage implements Storage {
  #values = new Map<string, string>();
  get length() {
    return this.#values.size;
  }
  clear() {
    this.#values.clear();
  }
  getItem(key: string) {
    return this.#values.get(key) ?? null;
  }
  key(index: number) {
    return [...this.#values.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.#values.delete(key);
  }
  setItem(key: string, value: string) {
    this.#values.set(key, value);
  }
}

const settings = {
  issuer: "https://identity.example.test",
  clientId: "synthetic-web",
  redirectUri: "https://app.example.test/oidc/callback",
};

describe("browser PKCE with a synthetic signed provider", () => {
  let storage: MemoryStorage;
  let authorization: URL;
  let auth: Authentication;
  let fixture: Awaited<ReturnType<typeof providerFixture>>;
  beforeEach(async () => {
    storage = new MemoryStorage();
    fixture = await providerFixture(settings);
    vi.stubGlobal("fetch", fixture.fetch);
    auth = new Authentication(settings, storage, (url) => {
      authorization = new URL(url);
      fixture.authorization = authorization;
    });
  });
  afterEach(() => {
    auth.logout();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function callback() {
    await auth.signIn();
    const url = new URL(settings.redirectUri);
    url.search = new URLSearchParams({
      code: "synthetic-code",
      state: authorization.searchParams.get("state")!,
      iss: settings.issuer,
    }).toString();
    return url;
  }

  it("uses personal OIDC, verifies signatures, consumes state and retains only access token in memory", async () => {
    const url = await callback();
    const params = authorization.searchParams;
    expect(params.get("scope")).toBe("openid data:read");
    expect(params.get("prompt")).toBe("login");
    expect(params.get("max_age")).toBe("0");
    expect(params.get("response_type")).toBe("code");
    expect(params.get("code_challenge_method")).toBe("S256");
    expect(params.has("offline_access")).toBe(false);
    const stored = JSON.parse(storage.getItem(REDIRECT_KEY)!) as Record<
      string,
      string
    >;
    expect(Object.keys(stored).sort()).toEqual(["nonce", "state", "verifier"]);
    expect(stored.verifier === params.get("code_challenge")).toBe(false);
    await auth.complete(url);
    expect(Boolean(auth.session?.accessToken)).toBe(true);
    expect(auth.session?.accessToken === fixture.accessToken).toBe(true);
    expect(fixture.pkceValid).toBe(true);
    expect(fixture.signatureRead).toBe(true);
    expect(storage.length).toBe(0);
    await expect(auth.complete(url)).rejects.toThrow("Sign-in unavailable");
    expect(auth.session).toBeUndefined();
    expect(
      new Authentication(settings, storage, () => {}).session,
    ).toBeUndefined();
  });

  it("requests operations only on explicit sign-in without granting browser authority", async () => {
    await auth.signIn(true);
    expect(authorization.searchParams.get("scope")).toBe(
      "openid data:read operations:read",
    );
    expect(authorization.searchParams.get("prompt")).toBe("login");
    expect(authorization.searchParams.get("max_age")).toBe("0");
    const url = new URL(settings.redirectUri);
    url.search = new URLSearchParams({
      code: "synthetic-code",
      state: authorization.searchParams.get("state")!,
      iss: settings.issuer,
    }).toString();
    // A provider may decline the optional scope while still admitting a reader.
    await auth.complete(url);
    expect(auth.session).toBeDefined();
    expect(storage.length).toBe(0);
    expect(Object.keys(auth.sessions.getSnapshot()).sort()).toEqual([
      "expiresAt",
      "generation",
      "phase",
    ]);
  });

  it("drops an expired memory token and purges an abandoned expired redirect on re-entry", async () => {
    const url = await callback();
    await auth.complete(url);
    const expiry = auth.session!.expiresAt;
    vi.spyOn(Date, "now").mockReturnValue(expiry);
    expect(auth.session).toBeUndefined();
    vi.restoreAllMocks();
    await auth.signIn();
    const created = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(created + REDIRECT_TTL);
    new Authentication(settings, storage, () => {});
    expect(storage.length).toBe(0);
  });

  it("does not navigate when transient storage cannot be written", async () => {
    vi.spyOn(storage, "setItem").mockImplementation(() => {
      throw new Error("synthetic-private-storage-error");
    });
    const navigate = vi.fn();
    auth = new Authentication(settings, storage, navigate);
    await expect(auth.signIn()).rejects.toThrow("Sign-in unavailable");
    expect(navigate).not.toHaveBeenCalled();
    expect(storage.length).toBe(0);
  });

  it.each(["wrong", "missing", "duplicate"])(
    "rejects %s state before exchanging a code",
    async (kind) => {
      const url = await callback();
      if (kind === "wrong") url.searchParams.set("state", "synthetic-wrong");
      if (kind === "missing") url.searchParams.delete("state");
      if (kind === "duplicate")
        url.searchParams.append("state", "synthetic-wrong");
      await expect(auth.complete(url)).rejects.toThrow("Sign-in unavailable");
      expect(fixture.exchanges).toBe(0);
      expect(storage.length).toBe(0);
      expect(auth.session).toBeUndefined();
    },
  );

  it.each([
    "wrong-issuer",
    "missing-issuer",
    "fragment",
    "other-return",
    "provider-error",
    "expired",
    "changed-client",
  ])("fails closed for %s", async (kind) => {
    const url = await callback();
    if (kind === "wrong-issuer")
      url.searchParams.set("iss", "https://other.example.test");
    if (kind === "missing-issuer") url.searchParams.delete("iss");
    if (kind === "fragment") url.hash = "synthetic";
    if (kind === "other-return") url.pathname = "/other";
    if (kind === "provider-error") {
      url.searchParams.delete("code");
      url.searchParams.set("error", "access_denied");
    }
    if (kind === "expired")
      vi.spyOn(Date, "now").mockReturnValue(Date.now() + REDIRECT_TTL);
    if (kind === "changed-client")
      auth = new Authentication(
        { ...settings, clientId: "other-client" },
        storage,
        () => {},
      );
    await expect(auth.complete(url)).rejects.toThrow("Sign-in unavailable");
    expect(fixture.exchanges).toBe(0);
    expect(storage.length).toBe(0);
    expect(auth.session).toBeUndefined();
  });

  it.each([
    "nonce",
    "signature",
    "id-issuer",
    "audience",
    "expired-id",
    "old-auth",
    "late-issuance",
    "refresh",
    "empty-refresh",
    "scope",
    "no-id",
    "no-expiry",
    "overlong",
    "exchange-refused",
    "redirect",
  ])("rejects synthetic %s response", async (kind) => {
    const url = await callback();
    fixture.failure = kind;
    await expect(auth.complete(url)).rejects.toThrow("Sign-in unavailable");
    expect(auth.session).toBeUndefined();
    expect(storage.length).toBe(0);
  });

  it.each([
    "metadata-issuer",
    "external-endpoint",
    "no-pkce",
    "discovery-refused",
  ])("does not redirect for %s metadata", async (kind) => {
    fixture.failure = kind;
    await expect(auth.signIn()).rejects.toThrow("Sign-in unavailable");
    expect(storage.length).toBe(0);
    expect(auth.session).toBeUndefined();
  });

  it("preserves only an intentional provider handoff and clears it on cancellation or restored page", async () => {
    await auth.signIn();
    auth.leaveDocument();
    expect(storage.length).toBe(1);
    expect(auth.session).toBeUndefined();
    auth.logout();
    expect(storage.length).toBe(0);
    await auth.signIn();
    auth.logout();
    auth.leaveDocument();
    expect(storage.length).toBe(0);
  });

  it("cancels pending discovery without a late redirect or write", async () => {
    let resolve!: (response: Response) => void;
    const pendingResponse = new Promise<Response>((done) => {
      resolve = done;
    });
    const navigate = vi.fn();
    auth = new Authentication(settings, storage, navigate);
    vi.stubGlobal("fetch", () => pendingResponse);
    const pending = auth.signIn();
    const rejected = expect(pending).rejects.toThrow("Sign-in unavailable");
    auth.logout();
    resolve(
      await fixture.fetch(
        settings.issuer + "/.well-known/openid-configuration",
        {},
      ),
    );
    await rejected;
    expect(navigate).not.toHaveBeenCalled();
    expect(storage.length).toBe(0);
    expect(auth.sessions.getSnapshot().phase).toBe("signed-out");
  });

  it("ignores a cancelled token exchange even after a second identity connects", async () => {
    const url = await callback();
    let release!: () => void;
    let received!: () => void;
    const requestReceived = new Promise<void>((done) => {
      received = done;
    });
    const delayed = new Promise<void>((done) => {
      release = done;
    });
    let firstToken = true;
    let oldSignal!: AbortSignal;
    vi.stubGlobal(
      "fetch",
      async (destination: string, options: RequestInit) => {
        const response = await fixture.fetch(destination, options);
        if (destination.endsWith("/token") && firstToken) {
          firstToken = false;
          oldSignal = options.signal!;
          received();
          await delayed;
        }
        return response;
      },
    );
    const pending = auth.complete(url);
    const rejected = expect(pending).rejects.toThrow("Sign-in unavailable");
    await requestReceived;
    auth.logout();
    expect(oldSignal.aborted).toBe(true);
    fixture.accessToken = "synthetic-second-access";
    await auth.complete(await callback());
    release();
    await rejected;
    expect(auth.session?.accessToken === fixture.accessToken).toBe(true);
    expect(auth.sessions.getSnapshot().phase).toBe("authenticated");
    expect(storage.length).toBe(0);
  });
});
