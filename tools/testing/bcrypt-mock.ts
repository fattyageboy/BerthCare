import crypto from 'crypto';

const BCRYPT_PREFIX = '$2b$12$';
const BCRYPT_BASE64_ALPHABET = './ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const TARGET_DELAY_MS = 180;

type HashFunction = (password: string, saltOrRounds: string | number) => Promise<string>;
type CompareFunction = (password: string, hash: string) => Promise<boolean>;

function toBcryptBase64(buffer: Buffer, outputLength: number): string {
  let output = '';
  let position = 0;

  while (output.length < outputLength) {
    const byte1 = buffer[position++] ?? 0;
    const byte2 = buffer[position++] ?? 0;
    const byte3 = buffer[position++] ?? 0;

    const combined = (byte1 << 16) | (byte2 << 8) | byte3;

    output += BCRYPT_BASE64_ALPHABET[(combined >> 18) & 0x3f];
    output += BCRYPT_BASE64_ALPHABET[(combined >> 12) & 0x3f];
    output += BCRYPT_BASE64_ALPHABET[(combined >> 6) & 0x3f];
    output += BCRYPT_BASE64_ALPHABET[combined & 0x3f];
  }

  return output.slice(0, outputLength);
}

function deriveHash(password: string, salt: string): string {
  const digest = crypto.createHash('sha256').update(`${password}:${salt}`).digest();
  return toBcryptBase64(digest, 31);
}

const asyncDelay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const hash: HashFunction = async (
  password: string,
  saltOrRounds: string | number
): Promise<string> => {
  const salt =
    typeof saltOrRounds === 'string'
      ? saltOrRounds.slice(BCRYPT_PREFIX.length, BCRYPT_PREFIX.length + 22)
      : toBcryptBase64(crypto.randomBytes(16), 22);

  const delay =
    typeof saltOrRounds === 'number'
      ? Math.min(Math.max(saltOrRounds - 1, 1) * 15, 400)
      : TARGET_DELAY_MS;
  await asyncDelay(delay);

  const hashPortion = deriveHash(password, salt);
  return `${BCRYPT_PREFIX}${salt}${hashPortion}`;
};

const compare: CompareFunction = async (password: string, hashValue: string): Promise<boolean> => {
  if (!hashValue.startsWith(BCRYPT_PREFIX) || hashValue.length !== 60) {
    throw new Error('Invalid bcrypt hash format');
  }

  const salt = hashValue.slice(BCRYPT_PREFIX.length, BCRYPT_PREFIX.length + 22);
  const expected = deriveHash(password, salt);
  await asyncDelay(5);

  return crypto.timingSafeEqual(Buffer.from(hashValue.slice(-31)), Buffer.from(expected));
};

export { hash, compare };

export default {
  hash,
  compare,
};
