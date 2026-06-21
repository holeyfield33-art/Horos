import { util } from "@/utils";
import { thing } from "some-external-lib";

export async function load(name: string): Promise<number> {
  const mod = await import(`./plugins/${name}`);
  return util + thing + (mod.default as number);
}
