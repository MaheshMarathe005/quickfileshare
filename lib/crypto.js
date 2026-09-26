// At-rest file encryption using AES-256-GCM. Files are encrypted before they are
// written to disk / uploaded to Drive, and decrypted only when a verified receiver
// downloads them. The key is derived (scrypt) from ENCRYPTION_KEY, or APP_SECRET.
import crypto from 'node:crypto';
import { config } from './config.js';

let cachedKey = null;
function getKey() {
  if (cachedKey) return cachedKey;
  const secret = config.encryptionKey || config.appSecret;
  // Fixed context salt: same secret always derives the same key (needed to decrypt later).
  cachedKey = crypto.scryptSync(secret, 'mahesh_fs.file-encryption.v1', 32);
  return cachedKey;
}

// Encrypt a Buffer. Returns { data: Buffer(ciphertext), iv, tag, alg } — iv/tag are
// stored in the share metadata (base64), the ciphertext becomes the stored blob.
export function encryptBuffer(plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const data = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { data, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), alg: 'aes-256-gcm' };
}

// Decrypt using the { iv, tag } stored in metadata plus the ciphertext buffer.
export function decryptBuffer({ iv, tag, data }) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(data), decipher.final()]);
}
