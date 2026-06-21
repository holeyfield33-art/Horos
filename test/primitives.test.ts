/**
 * Ed25519 sign/verify and SHA-256 — SPEC §2 primitives, §5 signing.
 *
 * The signing vector pins a fixed seed to a fixed public key and a fixed
 * signature over fixed canonical bytes (Ed25519 is deterministic). The
 * round-trip and tamper cases prove verify behaves.
 */

import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

import {
  sha256,
  generateEd25519KeyPair,
  ed25519PrivateKeyFromSeed,
  ed25519PublicKeyFromPrivate,
  ed25519PublicKeyFromHex,
  ed25519PublicKeyToHex,
  ed25519Sign,
  ed25519Verify,
} from "../src/canonical/index.js";

interface SigningVector {
  seed_hex: string;
  public_key_hex: string;
  message_cjson_hex: string;
  signature_hex: string;
}
interface VectorsFile {
  signing: SigningVector;
  _utf8_sanity: string;
}

const vectors: VectorsFile = JSON.parse(
  readFileSync(new URL("../vectors/canonical-forms.json", import.meta.url), "utf8"),
) as VectorsFile;

describe("sha256", () => {
  it("matches the known digest of 'abc'", () => {
    expect(sha256(new TextEncoder().encode("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("utf8 sanity vector", () => {
    expect(Buffer.from("a", "utf8").toString("hex")).toBe(vectors._utf8_sanity);
  });
});

describe("Ed25519 (deterministic, frozen vector)", () => {
  const v = vectors.signing;
  const priv = ed25519PrivateKeyFromSeed(v.seed_hex);
  const pub = ed25519PublicKeyFromPrivate(priv);
  const message = Buffer.from(v.message_cjson_hex, "hex");

  it("derives the frozen public key from the seed", () => {
    expect(ed25519PublicKeyToHex(pub)).toBe(v.public_key_hex);
  });

  it("produces the frozen signature", () => {
    expect(ed25519Sign(message, priv)).toBe(v.signature_hex);
  });

  it("verifies the frozen signature via a hex-imported public key", () => {
    const importedPub = ed25519PublicKeyFromHex(v.public_key_hex);
    expect(ed25519Verify(message, v.signature_hex, importedPub)).toBe(true);
  });

  it("rejects a tampered message", () => {
    const tampered = Buffer.concat([message, Buffer.from([0x00])]);
    expect(ed25519Verify(tampered, v.signature_hex, pub)).toBe(false);
  });

  it("rejects a tampered signature", () => {
    const bad = v.signature_hex.replace(/^.{2}/, "00") === v.signature_hex
      ? v.signature_hex.replace(/^.{2}/, "ff")
      : v.signature_hex.replace(/^.{2}/, "00");
    expect(ed25519Verify(message, bad, pub)).toBe(false);
  });
});

describe("Ed25519 round-trip with a generated key", () => {
  it("signs and verifies arbitrary bytes", () => {
    const { privateKey, publicKey } = generateEd25519KeyPair();
    const msg = new TextEncoder().encode("horos round-trip");
    const sig = ed25519Sign(msg, privateKey);
    expect(ed25519Verify(msg, sig, publicKey)).toBe(true);
    expect(ed25519Verify(new TextEncoder().encode("other"), sig, publicKey)).toBe(false);
  });

  it("round-trips a public key through hex", () => {
    const { privateKey } = generateEd25519KeyPair();
    const pub = ed25519PublicKeyFromPrivate(privateKey);
    const roundTripped = ed25519PublicKeyFromHex(ed25519PublicKeyToHex(pub));
    expect(ed25519PublicKeyToHex(roundTripped)).toBe(ed25519PublicKeyToHex(pub));
  });
});
