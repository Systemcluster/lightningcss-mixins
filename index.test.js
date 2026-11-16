import assert from 'node:assert/strict'
import fs from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { transform } from 'lightningcss'

import visitor from './index.js'

const assetPath = join(dirname(fileURLToPath(import.meta.url)), 'package.json')
const assetData = fs.readFileSync(assetPath).toString('base64')

/** @param {string} source */
const compile = (source) => transform({ filename: 'test.css', code: Buffer.from(source), visitor }).code.toString()

test('inline accepts a comma-separated MIME override', () => {
    const result = transform({
        filename: 'test.css',
        code: Buffer.from(`a { background: inline(${JSON.stringify(assetPath)}, "application/json"); }`),
        visitor,
    })

    assert.ok(result.code.toString().includes(`data:application/json;base64,${assetData}`))
})

test('inline preserves whitespace-separated MIME overrides', () => {
    assert.ok(
        compile(`a { background: inline(${JSON.stringify(assetPath)} "application/json"); }`).includes(
            `data:application/json;base64,${assetData}`
        )
    )
})

test('inline resolves both path aliases from the working directory', () => {
    for (const prefix of ['@', '@/']) {
        const path = `${prefix}${relative(process.cwd(), assetPath)}`
        assert.ok(
            compile(`a { background: inline(${JSON.stringify(path)}, "application/json"); }`).includes(
                `data:application/json;base64,${assetData}`
            )
        )
    }
})

test('inline infers common MIME types regardless of extension case', (context) => {
    const directory = fs.mkdtempSync(join(tmpdir(), 'lightningcss-mixins-'))
    context.after(() => fs.rmSync(directory, { recursive: true, force: true }))

    const mimeTypes = { SVG: 'svg+xml', JPG: 'jpeg', ICO: 'x-icon', WEBP: 'webp' }
    for (const [extension, mime] of Object.entries(mimeTypes)) {
        const path = join(directory, `asset.${extension}`)
        fs.writeFileSync(path, 'fixture')
        assert.ok(compile(`a { background: inline(${JSON.stringify(path)}); }`).includes(`data:image/${mime};base64,Zml4dHVyZQ==`))
    }
})

test('inline rejects invalid arguments before accessing the filesystem', () => {
    assert.throws(() => compile('a { background: inline(); }'), /expected 1 or 2 arguments/u)
    assert.throws(() => compile('a { background: inline(123); }'), /expected argument 1 to be a string/u)
    assert.throws(() => compile('a { background: inline("missing.svg", 123); }'), /expected argument 2 to be a string/u)
    assert.throws(() => compile('a { background: inline("missing.svg",); }'), /expected argument 2 to be a string/u)
    assert.throws(() => compile('a { background: inline("missing.svg", "image/svg+xml", "extra"); }'), /expected 1 or 2 arguments/u)
})

test('mixin parameter defaults and positional overrides remain supported', () => {
    assert.match(compile('@define tint(color: red) { color: $color; } a { @apply tint(); }'), /color: red;/u)
    assert.match(compile('@define tint(color: red) { color: $color; } a { @apply tint(blue); }'), /color: #00f;/u)
})

test('mixin argument errors retain source locations', () => {
    assert.throws(
        () => compile('@define tint(color) { color: $color; } a { @apply tint(); }'),
        /apply at \d+:\d+: Error: expected a value for argument: "color"/u
    )
    assert.throws(
        () => compile('@define tint(color) { color: $color; } a { @apply tint(red, blue); }'),
        /expected at most 1 arguments, got 2/u
    )
})

test('reusing the visitor uses the current stylesheet definitions', () => {
    assert.match(compile('@define reused { color: red; } a { @apply reused; }'), /color: red;/u)
    assert.match(compile('@define reused { color: blue; } a { @apply reused; }'), /color: #00f;/u)
})

test('definitions do not leak into another stylesheet', () => {
    compile('@define isolated { color: red; }')
    assert.throws(() => compile('a { @apply isolated; }'), /mixin not found: isolated/u)
})

test('direct recursion reports the expansion path', () => {
    assert.throws(
        () => compile('@define recursive() { @apply recursive(); } a { @apply recursive(); }'),
        /circular mixin application: recursive -> recursive/u
    )
})

test('indirect recursion reports the expansion path', () => {
    assert.throws(
        () => compile('@define first() { @apply second(); } @define second() { @apply first(); } a { @apply first(); }'),
        /circular mixin application: first -> second -> first/u
    )
})

test('repeated non-recursive nested applications remain valid', () => {
    assert.match(
        compile('@define leaf() { color: red; } @define parent() { @apply leaf(); @apply leaf(); } a { @apply parent(); }'),
        /color: red;/u
    )
})
