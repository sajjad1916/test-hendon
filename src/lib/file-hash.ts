import { createHash } from 'node:crypto';

export const sha256Hex = (data: Buffer | Uint8Array): string =>
  createHash('sha256').update(data).digest('hex');
