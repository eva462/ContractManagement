import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

/**
 * 用 Node 内置的 scrypt，不引入任何原生依赖 —— argon2 那类包在 Windows 上
 * 要 node-gyp 编译，装机成本高且容易失败。scrypt 是标准 KDF，这个规模完全够。
 */
const scryptAsync = promisify(scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
) => Promise<Buffer>

const KEY_LENGTH = 64
const SALT_LENGTH = 16

/** 统一 Unicode 规范化，避免同一个密码因输入法不同而哈希不一致 */
const normalize = (plain: string) => plain.normalize('NFKC')

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH)
  const key = await scryptAsync(normalize(plain), salt, KEY_LENGTH)
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const [alg, saltB64, keyB64] = stored.split('$')
  if (alg !== 'scrypt' || !saltB64 || !keyB64) return false

  let salt: Buffer
  let expected: Buffer
  try {
    salt = Buffer.from(saltB64, 'base64')
    expected = Buffer.from(keyB64, 'base64')
  } catch {
    return false
  }
  if (expected.length === 0) return false

  const actual = await scryptAsync(normalize(plain), salt, expected.length)
  // 定长比较，避免通过响应时间猜密码
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}
