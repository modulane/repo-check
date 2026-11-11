import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compareVersions, isSha, isVersion, parseUses } from '../src/uses.js'

const SHA = 'a'.repeat(40)

test('reads pinned actions with their version comment', () => {
  const [uses] = parseUses(
    `    steps:\n      - uses: actions/checkout@${SHA} # v7.0.1\n`,
  )
  assert.deepEqual(uses, {
    line: 2,
    value: `actions/checkout@${SHA}`,
    local: false,
    name: 'actions/checkout',
    ref: SHA,
    comment: 'v7.0.1',
  })
})

test('reads reusable workflow calls and quoted values', () => {
  const [call, quoted] = parseUses(
    `    uses: modulane/workflows/.github/workflows/zizmor.yml@${SHA} # v1.2.0\n` +
      `    uses: 'actions/setup-node@v4'\n`,
  )
  assert.equal(call.name, 'modulane/workflows/.github/workflows/zizmor.yml')
  assert.equal(call.comment, 'v1.2.0')
  assert.equal(quoted.name, 'actions/setup-node')
  assert.equal(quoted.ref, 'v4')
  assert.equal(quoted.comment, '')
})

test('marks local actions and workflows', () => {
  const uses = parseUses(
    '  uses: $/.github/workflows/ci.yml\n  uses: ./action\n  uses: docker://alpine:3\n',
  )
  assert.deepEqual(
    uses.map(entry => entry.local),
    [true, true, true],
  )
})

test('ignores lines that only mention uses', () => {
  assert.deepEqual(parseUses('# it uses: nothing\nname: uses\n'), [])
})

test('tells SHAs and versions apart', () => {
  assert.ok(isSha(SHA))
  assert.ok(!isSha('v4'))
  assert.ok(isVersion('v1.2.3'))
  assert.ok(!isVersion('v1'))
  assert.ok(!isVersion('1.2.3'))
})

test('compares versions by number', () => {
  assert.equal(compareVersions('v1.10.0', 'v1.9.0'), 1)
  assert.equal(compareVersions('v1.0.0', 'v1.2.0'), -1)
  assert.equal(compareVersions('v2.0.1', 'v2.0.1'), 0)
})
