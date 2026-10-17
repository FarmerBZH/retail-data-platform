export const CALLBACK_PATH = "/oidc/callback";

export type OidcSettings = {
  issuer: string;
  clientId: string;
  redirectUri: string;
};
export type OidcConfiguration =
  | { status: "missing" | "invalid" }
  | { status: "ready"; settings: OidcSettings };

export function secureUrl(value: unknown): URL | undefined {
  if (typeof value !== "string" || value.trim() !== value) return;
  try {
    const url = new URL(value);
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (
      (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return;
    return url;
  } catch {
    return;
  }
}

export function readOidcConfiguration(
  values: { issuer?: unknown; clientId?: unknown; redirectUri?: unknown },
  origin: string,
): OidcConfiguration {
  const entries = [values.issuer, values.clientId, values.redirectUri];
  if (entries.every((value) => value === undefined || value === ""))
    return { status: "missing" };
  const issuer = secureUrl(values.issuer);
  const redirect = secureUrl(values.redirectUri);
  if (
    !issuer ||
    !redirect ||
    typeof values.issuer !== "string" ||
    typeof values.clientId !== "string" ||
    !/^[A-Za-z0-9._:-]{1,128}$/.test(values.clientId) ||
    redirect.href !== `${origin}${CALLBACK_PATH}`
  )
    return { status: "invalid" };
  return {
    status: "ready",
    settings: {
      issuer: values.issuer,
      clientId: values.clientId,
      redirectUri: redirect.href,
    },
  };
}
