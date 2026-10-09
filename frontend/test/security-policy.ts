// Policy applied by the synthetic harness, not a production hosting configuration.
export const syntheticCsp = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self' https://api.example.test https://identity.example.test",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'none'",
  "worker-src 'none'",
].join("; ");
