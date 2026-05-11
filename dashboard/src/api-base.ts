const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0"]);

function trimSlash(value: string) {
  return value.replace(/\/+$/, "");
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

export function resolveDocsUrl(_currentOrigin: string, configured?: string) {
  const explicit = configured?.trim();
  if (explicit) return explicit;
  return "https://github.com/jssm/spidercrawl/tree/main/docs";
}
