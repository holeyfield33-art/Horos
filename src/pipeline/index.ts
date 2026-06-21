/** Selection pipeline — SPEC §6. */

export { selectContext, type SelectInput } from "./select.js";
export { verifySelectionContent, type VerifiableFile } from "./content-verify.js";
export type {
  SelectionResult,
  SelectedFile,
  Exclusion,
  Coverage,
} from "./types.js";
