function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function toCamelKey(key: string): string {
  return key.replace(/_([a-z])/g, (_, chr: string) => chr.toUpperCase());
}

export function normalizeApiPayload<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeApiPayload(item)) as T;
  }

  if (!isPlainObject(value)) {
    return value;
  }

  const normalized: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    normalized[toCamelKey(key)] = normalizeApiPayload(nested);
  }
  return normalized as T;
}

