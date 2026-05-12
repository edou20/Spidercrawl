const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0"]);

function trimSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function trimRouterBasename(value: string) {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "/") return "/";
  return `/${trimmed.replace(/^\/+|\/+$/g, "")}`;
}

export function resolveApiBaseUrl(currentOrigin: string, configured?: string) {
  const explicit = configured?.trim();
  if (explicit) return trimSlash(explicit);

  const url = new URL(trimSlash(currentOrigin));
  if (LOCAL_HOSTS.has(url.hostname) && url.port && url.port !== "3200") {
    url.port = "3200";
  }
  return url.origin;
}

export function joinApiUrl(base: string, path: string) {
  const normalizedBase = trimSlash(base);
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}

export function resolveRouterBasename(currentOrigin: string, configuredApiBase?: string, configuredBasename?: string) {
  const explicit = configuredBasename?.trim();
  if (explicit) return trimRouterBasename(explicit);

  const apiBase = configuredApiBase?.trim();
  if (apiBase) {
    try {
      const current = new URL(trimSlash(currentOrigin));
      const backend = new URL(trimSlash(apiBase));
      if (current.origin !== backend.origin) return "/";
    } catch {
      return "/";
    }
  }

  return "/app";
}

export function resolveDocsUrl(_currentOrigin: string, configured?: string) {
  const explicit = configured?.trim();
  if (explicit) return explicit;
  return "https://github.com/edou20/Spidercrawl/tree/main/docs";
}
