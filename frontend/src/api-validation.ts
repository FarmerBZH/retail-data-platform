// Decoders receive untrusted JSON and project only fields a consumer uses.
export type Decoder<T> = (value: unknown) => T;

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid response");
  return value as Record<string, unknown>;
}

export function text(value: unknown, maximum = 1024): string {
  if (typeof value !== "string" || value.length > maximum)
    throw new Error("Invalid response");
  return value;
}

export function nullable<T>(decode: Decoder<T>): Decoder<T | null> {
  return (value) => (value === null ? null : decode(value));
}

export function uuid(value: unknown): string {
  const result = text(value, 36);
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(result))
    throw new Error("Invalid response");
  return result;
}

export function decimal(value: unknown): string {
  const result = text(value, 256);
  if (!/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(result))
    throw new Error("Invalid response");
  return result;
}

export function date(value: unknown): string {
  const result = text(value, 10);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(result) ||
    !Number.isFinite(Date.parse(result)) ||
    new Date(result).toISOString().slice(0, 10) !== result
  )
    throw new Error("Invalid response");
  return result;
}

export function timestamp(value: unknown): string {
  const result = text(value, 40);
  if (
    !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(
      result,
    ) ||
    !Number.isFinite(Date.parse(result))
  )
    throw new Error("Invalid response");
  date(result.slice(0, 10));
  return result;
}

export function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw new Error("Invalid response");
  return value;
}

// Initial store-selection projection. Other published fields are not retained.
export function storeSummary(value: unknown) {
  const row = object(value);
  return {
    id: uuid(row.id),
    name: nullable((v) => text(v, 255))(row.name),
    retailerName: nullable((v) => text(v, 128))(row.retailer_name),
    city: nullable((v) => text(v, 128))(row.city),
    isActive: boolean(row.is_active),
  };
}
export type StoreSummary = ReturnType<typeof storeSummary>;
