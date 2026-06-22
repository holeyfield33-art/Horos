# Key management

Horos receipts are signed with an Ed25519 key that you generate and control.
This document explains how to create a keypair, where to keep it, and what the
trust model actually is for v0.x.

---

## Generating a keypair

The signing key is represented as a 32-byte seed (hex). Derive it once, store it
securely, and pass it to `scripts/route.mjs` (or to `ed25519PrivateKeyFromSeed`
in the library API) on each signing call.

**Generate a seed with Node (the same crypto used internally):**

```sh
node -e "import {randomBytes} from 'node:crypto'; \
  console.log(randomBytes(32).toString('hex'))"
# → a3f9d2e1b5c8...  (32 bytes = 64 hex chars)
```

That hex string is your private seed. It deterministically derives both the
private key and the public key:

```js
import { ed25519PrivateKeyFromSeed, ed25519PublicKeyFromPrivate,
         ed25519PublicKeyToHex } from "./dist/canonical/index.js";

const privateKey = ed25519PrivateKeyFromSeed("a3f9d2e1...");
const publicKeyHex = ed25519PublicKeyToHex(ed25519PublicKeyFromPrivate(privateKey));
// publicKeyHex is what appears in every receipt's signature.public_key
```

The `scripts/route.mjs` helper accepts the seed via `--key`:

```sh
node scripts/route.mjs graph.json "task text" --key "$HOROS_SIGNING_KEY" --out receipt.json
```

---

## Where to store the seed

**Personal/local use:**

Store the hex seed in an environment variable, not in the repository. Set it in
your shell profile or a `.env` file (and add that file to `.gitignore`):

```sh
# ~/.zshrc or ~/.bashrc
export HOROS_SIGNING_KEY="a3f9d2e1b5c8..."

# Or in a .env file (never commit)
echo 'HOROS_SIGNING_KEY=a3f9d2e1b5c8...' >> .env
echo '.env' >> .gitignore
```

**CI/CD:**

Store the seed as an encrypted secret in your CI provider (GitHub Actions secret,
GitLab variable, etc.) and reference it as `$HOROS_SIGNING_KEY`.

**What NOT to do:**

- Do not commit the seed to version control.
- Do not hard-code it in scripts checked into the repository.
- Do not share it — anyone with the seed can produce receipts that are
  indistinguishable from yours.

---

## What the `signature.public_key` field means

Every receipt contains:

```json
"signature": {
  "algorithm": "Ed25519",
  "public_key": "03a107bff3ce10be1d70dd18e74bc09967e4d6309ba50d5f1ddc8664125531b8",
  "value": "d81bc8c5..."
}
```

`public_key` is the raw 32-byte Ed25519 public key corresponding to the seed
used to sign that receipt, encoded as hex.

`horos verify` uses this public key to verify the signature — it does not look
up the key from any external registry. So:

**Trust in a receipt is exactly trust in that public key.**

If you want to trust receipts from someone else, you need to verify out-of-band
that the `public_key` value in the receipt belongs to them. Horos does not
provide a key registry or PKI.

---

## Honest scope: v0.x is single-signer, personal-use trust

There is no key rotation, no certificate chain, no PKI, and no revocation in
v0.x. The trust model is:

- One seed → one key → one signer
- You trust a receipt if you trust the signer who holds the corresponding seed
- Key rotation means generating a new seed and re-signing; old receipts signed
  with the old key remain valid against their stored `public_key`
- There is no mechanism to declare a public key revoked

This is adequate for personal use and team-internal audits where key distribution
happens out-of-band. For multi-party or public deployments where signers are not
personally known to verifiers, a PKI layer would be needed. That is explicitly
out of scope for v0.x.

---

## Verification without the private key

Verifying a receipt requires only the `public_key` field already stored in the
receipt, the graph, and the task text. No private key is needed for verification:

```sh
node dist/cli/horos.js verify receipt.json \
    --graph graph.json \
    --task "fix the auth session"
# → PASS <receipt_hash>   (or FAIL <field>: <detail>)
```

This means you can distribute receipts to anyone who needs to verify context
provenance without sharing any key material.
