import { URL } from "node:url";
import { isIP } from "node:net";

function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[|\]$/g, "");
}

function isBlockedIPv6(hostname: string): boolean {
  if (isIP(hostname) !== 6) return false;
  return (
    hostname === "::" ||
    hostname === "::1" ||
    hostname.startsWith("fc") ||
    hostname.startsWith("fd") ||
    hostname.startsWith("fe80:")
  );
}

/**
 * Validates that a URL is safe to fetch (prevents SSRF).
 * @param urlString The URL string to validate.
 * @throws {Error} If the URL is invalid or points to a private/internal address.
 */
export function validateURL(urlString: string): URL {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    throw new Error(`Invalid URL: ${urlString}`);
  }

  // Only allow http and https protocols.
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Invalid protocol: ${url.protocol}`);
  }

  // Prevent SSRF by blocking private and reserved IP ranges.
  const hostname = normalizeHostname(url.hostname);

  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new Error("SSRF protection: localhost is not allowed");
  }

  if (isBlockedIPv6(hostname)) {
    throw new Error(`SSRF protection: private IPv6 address not allowed: ${hostname}`);
  }

  // Block private IP ranges (RFC 1918) and local/reserved ranges.
  const privatePatterns = [
    /^10\./, // 10.0.0.0/8
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // 172.16.0.0/12
    /^192\.168\./, // 192.168.0.0/16
    /^169\.254\./, // link-local
    /^127\./, // loopback
    /^0\./, // "this" network
  ];

  for (const pattern of privatePatterns) {
    if (pattern.test(hostname)) {
      throw new Error(`SSRF protection: private IP address not allowed: ${hostname}`);
    }
  }

  // Block reserved IP ranges.
  const reservedPatterns = [
    /^224\./, // multicast
    /^240\./, // reserved
    /^255\.255\.255\.255$/, // broadcast
  ];

  for (const pattern of reservedPatterns) {
    if (pattern.test(hostname)) {
      throw new Error(`SSRF protection: reserved IP address not allowed: ${hostname}`);
    }
  }

  return url;
}

/**
 * Checks if a URL is external (different origin) from a base URL.
 * @param url The URL to check.
 * @param baseOrigin The base origin (scheme://host:port) to compare against.
 * @returns true if the URL is external, false if same origin.
 */
export function isExternalURL(url: URL, baseOrigin: string): boolean {
  return url.origin !== baseOrigin;
}
