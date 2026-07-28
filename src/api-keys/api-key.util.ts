import { createHash, randomBytes } from 'node:crypto';

// Same reasoning as RefreshToken/PasswordResetToken: the raw value is
// high-entropy random bytes, not a human password, so a fast deterministic
// hash is fine for equality lookups.
export function generateApiKey(): { raw: string; hash: string; prefix: string } {
  const raw = `pugey_live_${randomBytes(24).toString('hex')}`;
  const hash = createHash('sha256').update(raw).digest('hex');
  return { raw, hash, prefix: raw.slice(0, 18) };
}

export function hashApiKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}
