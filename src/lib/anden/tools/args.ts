export function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || !value.trim())
    throw new Error(`${key} is required and must be a non-empty string`);
  return value.trim();
}

export function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function requireNumber(args: Record<string, unknown>, key: string): number {
  const value = typeof args[key] === "number" ? args[key] : Number(args[key]);
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new Error(`${key} is required and must be a number`);
  return value;
}

export function optionalInteger(
  args: Record<string, unknown>,
  key: string,
  fallback: number,
  min: number,
  max: number
): number {
  const value = typeof args[key] === "number" ? args[key] : Number(args[key]);
  if (args[key] === undefined || args[key] === null || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

export function optionalBoolean(args: Record<string, unknown>, key: string): boolean | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") throw new Error(`${key} must be a boolean`);
  return value;
}
