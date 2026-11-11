import assert from 'node:assert/strict'
import { test } from 'node:test'
import { differences, inProse, normalize } from '../src/compare.js'
import { repoFromRemote } from '../src/github.js'
import { parseRepo } from '../src/sources.js'

test('only keys of the reference are compared', () => {
  assert.deepEqual(differences({ a: 1 }, { a: 1, extra: true }), [])
  assert.deepEqual(differences({ a: { b: 1 } }, { a: { b: 2 } }), ['a.b'])
  assert.deepEqual(differences({ a: 1 }, {}), ['a'])
})

test('arrays match in any order but not with other lengths', () => {
  assert.deepEqual(differences([{ x: 1 }, { x: 2 }], [{ x: 2 }, { x: 1 }]), [])
  assert.deepEqual(differences({ list: [1] }, { list: [1, 2] }), ['list'])
  assert.deepEqual(differences({ list: [1, 1] }, { list: [1, 2] }), ['list'])
})

test('line endings and trailing blank lines do not count', () => {
  assert.equal(normalize('a\r\nb\r\n\r\n'), 'a\nb')
})

test('lists read as prose', () => {
  assert.equal(inProse([]), '')
  assert.equal(inProse(['a']), 'a')
  assert.equal(inProse(['a', 'b', 'c']), 'a, b and c')
})

test('reads owner/repo from GitHub remotes', () => {
  assert.equal(
    repoFromRemote('https://github.com/modulane/repo-check.git\n'),
    'modulane/repo-check',
  )
  assert.equal(
    repoFromRemote('git@github.com:modulane/configs.git'),
    'modulane/configs',
  )
  assert.equal(repoFromRemote('https://gitlab.com/a/b.git'), null)
})

test('tells repositories and directories apart', () => {
  assert.deepEqual(parseRepo('modulane/repo-template@v1'), {
    repo: 'modulane/repo-template',
    ref: 'v1',
  })
  assert.equal(parseRepo('../repo-template'), null)
  assert.equal(parseRepo('C:\\dev\\repo'), null)
})
