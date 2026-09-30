import { describe, expect, it } from "vitest";
import { readConfiguration } from "./config";

describe("public API configuration", () => {
  it.each([undefined, ""])("reports absent configuration", (value) => {
    expect(readConfiguration(value)).toEqual({ status: "missing" });
  });

  it.each([
    "not-a-url",
    "http://api.example.test",
    "https://user:synthetic@api.example.test",
    "https://api.example.test/data",
    "https://api.example.test?token=synthetic",
    "https://api.example.test#synthetic",
    "javascript:alert(1)",
    123,
    " https://api.example.test",
    "http://localhost.example.test",
  ])("rejects invalid settings without reflecting their contents", (value) => {
    expect(readConfiguration(value)).toEqual({ status: "invalid" });
  });

  it.each([
    "https://api.example.test",
    "http://127.0.0.1:8000",
    "http://localhost:8000",
    "http://[::1]:8000",
  ])("allows HTTPS or loopback development origins", (origin) => {
    expect(readConfiguration(`${origin}/`)).toEqual({
      status: "configured",
      apiOrigin: origin,
    });
  });
});
