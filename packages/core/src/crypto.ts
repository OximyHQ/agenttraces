import { createCipheriv, createDecipheriv, generateKeyPairSync, randomBytes, sign, verify } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface EncryptedValue { cipher: Buffer; nonce: Buffer; tag: Buffer }

export function verifyDeviceSignature(publicKeyPem: string, value: string, signature: string): boolean {
  try {
    return verify(null, Buffer.from(value), publicKeyPem, Buffer.from(signature, "base64url"));
  } catch {
    return false;
  }
}

function privateFile(path: string, contents: Buffer | string) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, contents, { mode: 0o600 });
  chmodSync(path, 0o600);
}

export class LocalCrypto {
  readonly encryptionKey: Buffer;
  readonly privateKeyPem: string;
  readonly publicKeyPem: string;

  constructor(private readonly directory: string) {
    const encryptionPath = `${directory}/encryption.key`;
    if (!existsSync(encryptionPath)) privateFile(encryptionPath, randomBytes(32));
    this.encryptionKey = readFileSync(encryptionPath);

    const privatePath = `${directory}/device-private.pem`;
    const publicPath = `${directory}/device-public.pem`;
    if (!existsSync(privatePath) || !existsSync(publicPath)) {
      const pair = generateKeyPairSync("ed25519", {
        privateKeyEncoding: { type: "pkcs8", format: "pem" },
        publicKeyEncoding: { type: "spki", format: "pem" },
      });
      privateFile(privatePath, pair.privateKey);
      privateFile(publicPath, pair.publicKey);
    }
    this.privateKeyPem = readFileSync(privatePath, "utf8");
    this.publicKeyPem = readFileSync(publicPath, "utf8");
  }

  encrypt(value: string): EncryptedValue {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.encryptionKey, nonce);
    const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return { cipher: encrypted, nonce, tag: cipher.getAuthTag() };
  }

  decrypt(value: EncryptedValue): string {
    const decipher = createDecipheriv("aes-256-gcm", this.encryptionKey, value.nonce);
    decipher.setAuthTag(value.tag);
    return Buffer.concat([decipher.update(value.cipher), decipher.final()]).toString("utf8");
  }

  sign(value: string): string {
    return sign(null, Buffer.from(value), this.privateKeyPem).toString("base64url");
  }

  verify(value: string, signature: string): boolean {
    return verifyDeviceSignature(this.publicKeyPem, value, signature);
  }
}
