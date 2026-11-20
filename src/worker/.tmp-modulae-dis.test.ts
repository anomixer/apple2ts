import { readFileSync } from "node:fs";
import { pcodes } from "./instructions";
import { getInstructionString } from "../common/util_disassemble";

test("modulae dis", () => {
  const dump = readFileSync(".tmp-modulae-dump/main-0-bfff.bin");
  let addr = 0x1100;
  const out: string[] = [];
  while (addr < 0x2a80) {
    const code = pcodes[dump[addr]];
    if (!code) break;
    const vLo = dump[(addr + 1) & 0xffff];
    const vHi = dump[(addr + 2) & 0xffff];
    out.push(getInstructionString(addr, code as unknown as import("../common/util_disassemble").PCodeInstr1, vLo, vHi, -1));
    addr += code.bytes;
  }
  console.log(out.join("\n"));
});
