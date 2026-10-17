export type Configuration =
  | { status: "missing" }
  | { status: "invalid" }
  | { status: "configured"; apiOrigin: string };

// Public build-time setting only. Credentials never belong in Vite variables.
export function readConfiguration(value: unknown): Configuration {
  if (value === undefined || value === "") return { status: "missing" };
  if (typeof value !== "string" || value.trim() !== value)
    return { status: "invalid" };

  try {
    const url = new URL(value);
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (
      (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      return { status: "invalid" };
    }
    return { status: "configured", apiOrigin: url.origin };
  } catch {
    return { status: "invalid" };
  }
}
