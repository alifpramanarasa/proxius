// Validator & inferrer JSON Schema minimal (subset Draft-07), tanpa dependency.
// Cukup untuk contract-testing QA: type, properties, required, items, enum,
// const, min/max, length, pattern, format umum, nullable, anyOf/oneOf/allOf.
// Bukan implementasi penuh — sengaja kecil & offline (local-first).

export type JsonSchema = Record<string, any>;

function typeOf(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v; // string | number | boolean | object
}

function matchesType(v: unknown, t: string): boolean {
  if (t === "integer") return typeof v === "number" && Number.isInteger(v);
  if (t === "number") return typeof v === "number";
  return typeOf(v) === t;
}

const FORMATS: Record<string, RegExp> = {
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  uri: /^[a-z][a-z0-9+.-]*:\/\/.+/i,
  url: /^[a-z][a-z0-9+.-]*:\/\/.+/i,
  uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  "date-time": /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
  date: /^\d{4}-\d{2}-\d{2}$/,
  ipv4: /^(\d{1,3}\.){3}\d{1,3}$/,
};

/** Validasi `value` terhadap `schema`. Mengembalikan daftar error (kosong = valid). */
export function validateSchema(schema: JsonSchema, value: unknown, path = "$"): string[] {
  const errs: string[] = [];
  if (schema == null || typeof schema !== "object") return errs;

  // Kombinator
  if (Array.isArray(schema.allOf)) {
    for (const sub of schema.allOf) errs.push(...validateSchema(sub, value, path));
  }
  if (Array.isArray(schema.anyOf)) {
    if (!schema.anyOf.some((sub: JsonSchema) => validateSchema(sub, value, path).length === 0))
      errs.push(`${path}: tidak memenuhi anyOf`);
  }
  if (Array.isArray(schema.oneOf)) {
    const ok = schema.oneOf.filter((sub: JsonSchema) => validateSchema(sub, value, path).length === 0);
    if (ok.length !== 1) errs.push(`${path}: harus memenuhi tepat satu oneOf (cocok ${ok.length})`);
  }

  // type (string atau array of string; array mendukung nullable)
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t: string) => matchesType(value, t))) {
      errs.push(`${path}: bertipe ${typeOf(value)}, diharapkan ${types.join("|")}`);
      return errs; // cek lanjutan tak berarti jika tipe salah
    }
  }

  if (schema.enum && !schema.enum.some((e: unknown) => JSON.stringify(e) === JSON.stringify(value)))
    errs.push(`${path}: bukan salah satu enum`);
  if ("const" in schema && JSON.stringify(schema.const) !== JSON.stringify(value))
    errs.push(`${path}: harus sama dengan const`);

  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum)
      errs.push(`${path}: ${value} < minimum ${schema.minimum}`);
    if (typeof schema.maximum === "number" && value > schema.maximum)
      errs.push(`${path}: ${value} > maximum ${schema.maximum}`);
  }

  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength)
      errs.push(`${path}: panjang < ${schema.minLength}`);
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength)
      errs.push(`${path}: panjang > ${schema.maxLength}`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value))
      errs.push(`${path}: tidak cocok pattern`);
    if (schema.format && FORMATS[schema.format] && !FORMATS[schema.format].test(value))
      errs.push(`${path}: format ${schema.format} tidak valid`);
  }

  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems)
      errs.push(`${path}: item < ${schema.minItems}`);
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems)
      errs.push(`${path}: item > ${schema.maxItems}`);
    if (schema.items)
      value.forEach((v, i) => errs.push(...validateSchema(schema.items, v, `${path}[${i}]`)));
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    if (Array.isArray(schema.required))
      for (const key of schema.required)
        if (!(key in obj)) errs.push(`${path}.${key}: field wajib tidak ada`);
    if (schema.properties)
      for (const [key, sub] of Object.entries(schema.properties))
        if (key in obj) errs.push(...validateSchema(sub as JsonSchema, obj[key], `${path}.${key}`));
    if (schema.additionalProperties === false && schema.properties) {
      const allowed = new Set(Object.keys(schema.properties));
      for (const key of Object.keys(obj))
        if (!allowed.has(key)) errs.push(`${path}.${key}: properti tak diizinkan`);
    }
  }

  return errs;
}

/** Infer JSON Schema Draft-07 sederhana dari sebuah nilai contoh. */
export function inferSchema(value: unknown): JsonSchema {
  const t = typeOf(value);
  switch (t) {
    case "object": {
      const obj = value as Record<string, unknown>;
      const properties: Record<string, JsonSchema> = {};
      for (const [k, v] of Object.entries(obj)) properties[k] = inferSchema(v);
      return { type: "object", properties, required: Object.keys(obj) };
    }
    case "array": {
      const arr = value as unknown[];
      return arr.length
        ? { type: "array", items: inferSchema(arr[0]) }
        : { type: "array" };
    }
    case "number":
      return { type: Number.isInteger(value as number) ? "integer" : "number" };
    case "null":
      return { type: "null" };
    default:
      return { type: t }; // string | boolean
  }
}

/** Ringkasan hasil validasi untuk pesan assertion. */
export function validateJsonText(schemaText: string, jsonText: string): { valid: boolean; message: string } {
  let schema: JsonSchema;
  try {
    schema = JSON.parse(schemaText);
  } catch {
    return { valid: false, message: "schema bukan JSON valid" };
  }
  let value: unknown;
  try {
    value = JSON.parse(jsonText);
  } catch {
    return { valid: false, message: "body bukan JSON valid" };
  }
  const errs = validateSchema(schema, value);
  return errs.length
    ? { valid: false, message: errs.slice(0, 3).join("; ") + (errs.length > 3 ? ` (+${errs.length - 3})` : "") }
    : { valid: true, message: "" };
}
