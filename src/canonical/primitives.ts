/**
 * Cryptographic primitives — SPEC §2 ("Primitives") and §5 (signing).
 *
 * `sha256(bytes) -> hex` and Ed25519 sign/verify. Ed25519 keys and signatures
 * cross the wire as hex (the receipt stores `public_key` and `value` as hex), so
 * the helpers here convert between hex and Node `KeyObject`s. Ed25519 signing is
 * deterministic, so a fixed seed yields a fixed public key and a fixed signature
 * over a fixed message — which is what makes the signing test vectors freezable.
 */

import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as nodeSign,
  verify as nodeVerify,
  type KeyObject,
} from "node:crypto";

/** SHA-256 of raw bytes, returned as lowercase hex. */
export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

// PKCS#8 DER prefix for an Ed25519 private key (RFC 8410), followed by the
// 32-byte seed. Lets us build a KeyObject from a raw seed without deriving the
// public key by hand.
const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

export interface Ed25519KeyPair {
  readonly privateKey: KeyObject;
  readonly publicKey: KeyObject;
}

export function generateEd25519KeyPair(): Ed25519KeyPair {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return { privateKey, publicKey };
}

/** Build an Ed25519 private key from a 32-byte seed given as hex. */
export function ed25519PrivateKeyFromSeed(seedHex: string): KeyObject {
  const seed = Buffer.from(seedHex, "hex");
  if (seed.length !== 32) {
    throw new Error(`Ed25519 seed must be 32 bytes, got ${String(seed.length)}`);
  }
  const der = Buffer.concat([ED25519_PKCS8_PREFIX, seed]);
  return createPrivateKey({ key: der, format: "der", type: "pkcs8" });
}

/** Derive the public key object from a private key object. */
export function ed25519PublicKeyFromPrivate(privateKey: KeyObject): KeyObject {
  return createPublicKey(privateKey);
}

/** Import an Ed25519 public key from its raw 32-byte value given as hex. */
export function ed25519PublicKeyFromHex(publicKeyHex: string): KeyObject {
  const x = Buffer.from(publicKeyHex, "hex").toString("base64url");
  return createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x }, format: "jwk" });
}

/** Export an Ed25519 public key object to its raw 32-byte value as hex. */
export function ed25519PublicKeyToHex(publicKey: KeyObject): string {
  const jwk = publicKey.export({ format: "jwk" });
  if (jwk.x === undefined) {
    throw new Error("key object is not an Ed25519 public key");
  }
  return Buffer.from(jwk.x, "base64url").toString("hex");
}

/** Sign a message, returning the raw 64-byte Ed25519 signature as hex. */
export function ed25519Sign(message: Uint8Array, privateKey: KeyObject): string {
  return Buffer.from(nodeSign(null, message, privateKey)).toString("hex");
}

/** Verify a hex Ed25519 signature against a message and public key. */
export function ed25519Verify(
  message: Uint8Array,
  signatureHex: string,
  publicKey: KeyObject,
): boolean {
  return nodeVerify(null, message, publicKey, Buffer.from(signatureHex, "hex"));
}
