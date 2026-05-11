type IntegerSettingOptions = {
  min?: number;
  max?: number;
};

function clamp(value: number, options: IntegerSettingOptions): number {
  let next = value;
  if (options.min !== undefined && next < options.min) next = options.min;
  if (options.max !== undefined && next > options.max) next = options.max;
  return next;
}

export function parseIntegerSetting(
  raw: string | undefined,
  fallback: number,
  options: IntegerSettingOptions = {},
): number {
  const fallbackValue = clamp(Math.floor(fallback), options);
  if (raw === undefined || raw.trim() === "") return fallbackValue;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallbackValue;

  return clamp(Math.floor(parsed), options);
}

export function readIntegerEnv(
  name: string,
  fallback: number,
  options: IntegerSettingOptions = {},
): number {
  return parseIntegerSetting(process.env[name], fallback, options);
}
