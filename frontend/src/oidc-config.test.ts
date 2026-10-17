import { describe, expect, it } from "vitest";
import { readOidcConfiguration } from "./oidc-config";

const values = {
  issuer: "https://identity.example.test/realm",
  clientId: "synthetic-web",
  redirectUri: "https://app.example.test/oidc/callback",
};
describe("public OIDC settings", () => {
  it("requires complete settings and an exact callback on this origin", () => {
    expect(readOidcConfiguration({}, "https://app.example.test")).toEqual({
      status: "missing",
    });
    expect(readOidcConfiguration(values, "https://app.example.test")).toEqual({
      status: "ready",
      settings: values,
    });
  });
  it.each([
    { issuer: "http://identity.example.test" },
    { issuer: "https://user:synthetic@identity.example.test" },
    { issuer: "https://identity.example.test?secret=synthetic" },
    { issuer: "https://identity.example.test#synthetic" },
    { clientId: "" },
    { clientId: "synthetic secret" },
    { redirectUri: "https://other.example.test/oidc/callback" },
    { redirectUri: "https://app.example.test/*" },
    { redirectUri: "https://app.example.test/oidc/callback?next=synthetic" },
    { redirectUri: undefined },
  ])("rejects unsafe/incomplete configuration generically", (override) => {
    expect(
      readOidcConfiguration(
        { ...values, ...override },
        "https://app.example.test",
      ),
    ).toEqual({ status: "invalid" });
  });
});
