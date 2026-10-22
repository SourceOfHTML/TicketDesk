import { z } from 'zod';

// SQLite has no enum type (ADR-0003); these are the only guarantees of the legal values.
export const roleSchema = z.enum(['USER', 'STAFF']);
export type Role = z.infer<typeof roleSchema>;

export const signupSchema = z.strictObject({
  email: z.email().trim().toLowerCase(),
  password: z.string().min(1),
});

export type SignupInput = z.infer<typeof signupSchema>;

export const loginSchema = z.strictObject({
  email: z.email().trim().toLowerCase(),
  password: z.string().min(1),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const userSummarySchema = z.object({
  id: z.string(),
  email: z.email(),
  role: roleSchema,
});

export type UserSummary = z.infer<typeof userSummarySchema>;
