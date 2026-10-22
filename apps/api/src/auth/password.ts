import { argon2id, hash } from 'argon2';

export function hashPassword(password: string): Promise<string> {
  return hash(password, { type: argon2id });
}
