import {itBench, setBenchOpts} from "@dapplion/benchmark";
import {hash} from "@chainsafe/persistent-merkle-tree";
import {expect} from "chai";
import {toBufferLE, toBufferBE, toBigIntLE, toBigIntBE} from "bigint-buffer";
import {hashAsBigInt, hashAsBuffer, HashType} from "bigint-hash";

describe("conversions", () => {
  const zero64 = Buffer.alloc(64, 0);
  const bytes64 = new Uint8Array(64);
  const rootA = Buffer.alloc(32, 203);
  const rootB = Buffer.alloc(32, 174);
  const buff64B = Buffer.concat([rootA, rootB]);
  const bg = BigInt("0xaabbccddaabbccddaabbccddaabbccddaabbccddaabbccddaabbccddaabbccdd");
  const bg1 = bg + BigInt(1);
  const bg2 = bg + BigInt(2);

  setBenchOpts({
    maxMs: 10 * 1000,
    minMs: 2 * 1000,
    runs: 1024,
  });

  it("bigint -> Buffer -> bigint", () => {
    const bg2 = bufToBigint(bigintToBuf(bg));
    expect(bg2).to.equal(bg);
  });

  itBench("hash 2 x 32 bytes (bigint)", () => {
    hashAsBigInt(HashType.SHA3_256, buff64B);
  });

  itBench("concat Buffer", () => {
    Buffer.concat([rootA, rootB]);
  });

  itBench({id: "concat Uint8Array", beforeEach: () => bytes64.set(zero64)}, () => {
    bytes64.set(rootA, 0);
    bytes64.set(rootB, 32);
  });

  itBench("bigint -> Buffer", () => {
    toBufferBE(bg, 32);
  });

  itBench("Buffer -> bigint", () => {
    toBigIntBE(rootA);
  });

  itBench("hash 2 x 32 bytes", () => {
    hash(rootA, rootB);
  });
});

function bufToBigint(buf: Uint8Array): bigint {
  const bits = BigInt(8);

  let ret = BigInt(0);
  for (const i of buf.values()) {
    const bi = BigInt(i);
    ret = (ret << bits) + bi;
  }
  return ret;
}

function bigintToBuf(bg: bigint): Uint8Array {
  for (let i = 0; i < 32; i++) {
    //
  }
  return Buffer.from(bg.toString(16), "hex");
}
