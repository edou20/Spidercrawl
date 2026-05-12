import { describe, expect, it } from "vitest";
import { validateURL } from "../src/lib/url-utils.js";

describe("validateURL", () => {
  it("accepts public HTTP and HTTPS URLs", () => {
    expect(validateURL("https://example.com/path").href).toBe("https://example.com/path");
    expect(validateURL("http://example.com/").href).toBe("http://example.com/");
  });

  it("rejects protocols that are not exactly HTTP or HTTPS", () => {
    expect(() => validateURL("ftp://example.com")).toThrow("Invalid protocol: ftp:");
    expect(() => validateURL("httpx://example.com")).toThrow("Invalid protocol: httpx:");
  });

  it("rejects localhost and private IPv4 URLs with SSRF-specific errors", () => {
    expect(() => validateURL("http://localhost:3000")).toThrow("SSRF protection");
    expect(() => validateURL("http://127.0.0.1")).toThrow("SSRF protection");
    expect(() => validateURL("http://10.1.2.3")).toThrow("SSRF protection");
    expect(() => validateURL("http://172.16.0.1")).toThrow("SSRF protection");
    expect(() => validateURL("http://192.168.1.1")).toThrow("SSRF protection");
  });

  it("rejects local and private IPv6 URLs", () => {
    expect(() => validateURL("http://[::1]/")).toThrow("SSRF protection");
    expect(() => validateURL("http://[fc00::1]/")).toThrow("SSRF protection");
    expect(() => validateURL("http://[fe80::1]/")).toThrow("SSRF protection");
  });

  it("uses a parse-specific error for malformed URLs", () => {
    expect(() => validateURL("not a url")).toThrow("Invalid URL: not a url");
  });
});
