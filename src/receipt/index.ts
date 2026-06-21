/** Receipt assembly, hashing, signing — SPEC §5. */

export {
  buildReceipt,
  receiptSigningBytes,
  recomputeReceiptHash,
  verifyReceiptSignature,
  toChainLink,
  type BuildReceiptInput,
} from "./receipt.js";

export type {
  Receipt,
  ReceiptRepository,
  ReceiptTask,
  ReceiptSelector,
  ReceiptGraph,
  ReceiptSignature,
  ChainLink,
} from "./types.js";
