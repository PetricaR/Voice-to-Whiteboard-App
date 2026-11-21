/**
 * Brings a function call's arguments in line with the tool's declared schema
 * before the tool runs. The model usually follows the schema, but not always:
 * a `null` inside a list, a number where a string belongs or one object where
 * a list of them was declared would otherwise reach the engines and fail with
 * a TypeError the model cannot act on.
 *
 *   - STRING:  numbers and booleans become text; other values are dropped.
 *   - INTEGER / NUMBER: numeric text becomes a number; other values are dropped.
 *   - BOOLEAN: "true" / "false" become booleans; other values are dropped.
 *   - ARRAY:   a single value becomes a list of one; null items are dropped.
 *   - OBJECT:  a non-object is dropped; declared properties are coerced in turn,
 *              undeclared ones (e.g. camelCase aliases) are kept as they are.
 *
 * `null` itself is kept wherever it is not a list item: the engines read it as
 * "clear this setting".
 */

export interface ArgSchema {
  type?: string;
  properties?: Record<string, ArgSchema>;
  items?: ArgSchema;
}

/** The coerced value, or undefined when it cannot be read as the schema's type. */
export function coerceToSchema(value: unknown, schema: ArgSchema | undefined): unknown {
  if (value === null || schema?.type == null) return value;
  switch (schema.type) {
    case 'STRING':
      if (typeof value === 'string') return value;
      if (typeof value === 'number' || typeof value === 'boolean') return String(value);
      return undefined;
    case 'INTEGER':
    case 'NUMBER':
      if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
      if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
      return undefined;
    case 'BOOLEAN':
      if (typeof value === 'boolean') return value;
      if (value === 'true') return true;
      if (value === 'false') return false;
      return undefined;
    case 'ARRAY': {
      const list = Array.isArray(value) ? value : value === undefined ? undefined : [value];
      return list?.map((item) => coerceToSchema(item, schema.items)).filter((item) => item != null);
    }
    case 'OBJECT': {
      if (value === undefined || typeof value !== 'object' || Array.isArray(value)) return undefined;
      if (schema.properties == null) return value;
      const out: Record<string, unknown> = { ...(value as Record<string, unknown>) };
      for (const [key, propSchema] of Object.entries(schema.properties)) {
        if (!(key in out)) continue;
        const coerced = coerceToSchema(out[key], propSchema);
        if (coerced === undefined) delete out[key];
        else out[key] = coerced;
      }
      return out;
    }
    default:
      return value;
  }
}

/** The arguments of a call to a declared tool, coerced to its parameter schema. */
export function coerceArgs(
  args: Record<string, unknown> | undefined,
  parameters: ArgSchema | undefined,
): Record<string, unknown> {
  const coerced = coerceToSchema(args ?? {}, parameters ?? { type: 'OBJECT' });
  return (coerced as Record<string, unknown> | undefined) ?? {};
}
