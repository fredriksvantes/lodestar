const assert = require('chai').assert
const BN = require('bn.js')

const hexToBytes = require('./utils/hexToBytes').hexToBytes
const treeHash = require('../src').treeHash
const merkleHash = require('../src').merkleHash
const testObjects = require('./utils/objects')

const SimpleObject = testObjects.SimpleObject
const OuterObject = testObjects.OuterObject
const InnerObject = testObjects.InnerObject
const ArrayObject = testObjects.ArrayObject


describe('SimpleSerialize - tree hashes', () => {
  const testCases = [
    // bool
    [[false, 'bool'], '0000000000000000000000000000000000000000000000000000000000000000'],
    [[true, 'bool'], '0100000000000000000000000000000000000000000000000000000000000000'],
    // uint8
    [[0, 'uint8'], "0000000000000000000000000000000000000000000000000000000000000000"],
    [[1, 'uint8'], "0100000000000000000000000000000000000000000000000000000000000000"],
    [[16, 'uint8'], "1000000000000000000000000000000000000000000000000000000000000000"],
    [[128, 'uint8'], "8000000000000000000000000000000000000000000000000000000000000000"],
    [[255, 'uint8'], "ff00000000000000000000000000000000000000000000000000000000000000"],
    // uint16
    [[0, 'uint16'], "0000000000000000000000000000000000000000000000000000000000000000"],
    [[1, 'uint16'], "0100000000000000000000000000000000000000000000000000000000000000"],
    [[16, 'uint16'], "1000000000000000000000000000000000000000000000000000000000000000"],
    [[128, 'uint16'], "8000000000000000000000000000000000000000000000000000000000000000"],
    [[255, 'uint16'], "ff00000000000000000000000000000000000000000000000000000000000000"],
    [[65535, 'uint16'], "ffff000000000000000000000000000000000000000000000000000000000000"],
    // uint32
    [[0, 'uint32'], "0000000000000000000000000000000000000000000000000000000000000000"],
    [[1, 'uint32'], "0100000000000000000000000000000000000000000000000000000000000000"],
    [[16, 'uint32'], "1000000000000000000000000000000000000000000000000000000000000000"],
    [[128, 'uint32'], "8000000000000000000000000000000000000000000000000000000000000000"],
    [[255, 'uint32'], "ff00000000000000000000000000000000000000000000000000000000000000"],
    [[65535, 'uint32'], "ffff000000000000000000000000000000000000000000000000000000000000"],
    [[4294967295, 'uint32'], "ffffffff00000000000000000000000000000000000000000000000000000000"],
    // uint64
    [[0, 'uint64'], "0000000000000000000000000000000000000000000000000000000000000000"],
    [[1, 'uint64'], "0100000000000000000000000000000000000000000000000000000000000000"],
    [[16, 'uint64'], "1000000000000000000000000000000000000000000000000000000000000000"],
    [[128, 'uint64'], "8000000000000000000000000000000000000000000000000000000000000000"],
    [[255, 'uint64'], "ff00000000000000000000000000000000000000000000000000000000000000"],
    [[65535, 'uint64'], "ffff000000000000000000000000000000000000000000000000000000000000"],
    [[4294967295, 'uint64'], "ffffffff00000000000000000000000000000000000000000000000000000000"],
    [[new BN('18446744073709551615'), 'uint64'], "ffffffffffffffff000000000000000000000000000000000000000000000000"],
    // bytes
    [[Buffer.alloc(0), 'bytes'],'e8e77626586f73b955364c7b4bbf0bb7f7685ebd40e852b164633a4acbd3244c'],
    [[Buffer.from([1]), 'bytes'], 'b2559fed89f0ec17542c216683dc6b75506f3754e0c045742936742cae6343ca'],
    [[Buffer.from([1, 2, 3, 4, 5, 6]), 'bytes'], '1310542d28be8e0b3ff72e985bc06232b9a30d93ae1ad2e33c5383a54ab5c9a7'],
    // array
    [[[], ['uint16']], 'dfded4ed5ac76ba7379cfe7b3b0f53e768dca8d45a34854e649cfc3c18cbd9cd'],
    [[[1], ['uint16']], 'e3f121f639dae19b7e2fd6f5002f321b83f17288a7ca7560f81c2ace832cc5d5'],
    [[[1, 2], ['uint16']], 'a9b7d66d80f70c6da7060c3dedb01e6ed6cea251a3247093cbf27a439ecb0bea'],
    [[[[1,2,3,4],[5,6,7,8]], [['uint16']]], '1a400eb17c755e4445c2c57dd2d3a0200a290c56cd68957906dd7bfe04493b10'],
    // object
    [[new SimpleObject({b:0,a:0}), SimpleObject], '99ff0d9125e1fc9531a11262e15aeb2c60509a078c4cc4c64cefdfb06ff68647'],
    [[new SimpleObject({b:2,a:1}), SimpleObject], 'd2b49b00c76582823e30b56fe608ff030ef7b6bd7dcc16b8994c9d74860a7e1c'],
    [[new OuterObject({v:3,subV: new InnerObject({v:6})}), OuterObject], 'bb2f30386c55445381eee7a33c3794227b8c8e4be4caa54506901a4ddfe79ee2'],
    [[new ArrayObject({v: [new SimpleObject({b:2,a:1}), new SimpleObject({b:4,a:3})]}), ArrayObject], 'f3032dce4b4218187e34aa8b6ef87a3fabe1f8d734ce92796642dc6b2911277c'],
    [[[new OuterObject({v:3,subV: new InnerObject({v:6})}), new OuterObject({v:5,subV: new InnerObject({v:7})})], [OuterObject]], 'de43bc05aa6b011121f9590c10de1734291a595798c84a0e3edd1cc1e6710908'],
  ]
  const stringifyType = type => {
    if (typeof type === 'string') {
      return type
    } else if (Array.isArray(type)) {
      return `[${stringifyType(type[0])}]`
    } else if (typeof type === 'function') {
      return type.name
    } else return ''
  }
  for (const [input, output] of testCases) {
    const [value, type] = input
    it(`successfully tree hashes ${stringifyType(type)}`, () => {
      assert.equal(treeHash(value, type).toString('hex'), output)
    })
  }
})

describe('SimpleSerialize - merkle hashes', () => {
  const testCases = [
    [[], 'dfded4ed5ac76ba7379cfe7b3b0f53e768dca8d45a34854e649cfc3c18cbd9cd'],
    [[Buffer.from([1,2]), Buffer.from([3,4])], '64f741b8bab62525a01f9084582c148ff56c82f96dc12e270d3e7b5103cf7b48'],
    [[1,2,3,4,5,6,7,8,9,10].map(i => Buffer.alloc(16,i)), '839d98509e2efc53bd1dea17403921a89856e275bbf4d56c600cc3f6730aaffa'],
    [[1,2,3,4,5,6,7,8,9,10].map(i => Buffer.alloc(32,i)), '55dc6699e7b5713dd9102224c302996f931836c6dae9a4ec6ab49c966f394685'],
  ]
  for (const [input, output] of testCases) {
    it('successfully merkle hashes', () => {
      assert.equal(merkleHash(input).toString('hex'), output)
    })
  }
})

