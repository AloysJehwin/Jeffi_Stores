import { z } from "zod";
import { NextResponse } from "next/server";

export const zUuid = z.string().uuid();

export const zEmail = z.string().email().transform((v) => v.toLowerCase());

export const zIndianPin = z
  .string()
  .regex(/^\d{6}$/, "Must be exactly 6 digits");

export const zPositiveInt = z.number().int().min(1);

export const zNonEmpty = z
  .string()
  .trim()
  .min(1, "Must not be empty");

export const zCurrency = z.number().min(0);

export const zPhone = z
  .string()
  .regex(/^[6-9]\d{9}$/, "Must be a 10-digit Indian mobile number");

type ParseOk<T> = { ok: true; data: T };
type ParseFail = { ok: false; response: NextResponse };
type ParseResult<T> = ParseOk<T> | ParseFail;

export function parseBody<T>(
  schema: z.ZodType<T>,
  data: unknown
): ParseResult<T> {
  const result = schema.safeParse(data);

  if (result.success) {
    return { ok: true, data: result.data };
  }

  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join(".");
    if (key) {
      fields[key] = issue.message;
    }
  }

  const body: { error: string; fields?: Record<string, string> } = {
    error: "Validation failed",
  };

  if (Object.keys(fields).length > 0) {
    body.fields = fields;
  }

  return {
    ok: false,
    response: NextResponse.json(body, { status: 400 }),
  };
}
