import assert from 'node:assert/strict'
import fs from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { transform } from 'lightningcss'

import visitor, { createVisitor, vitePluginDisableWarnings } from './index.js'

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

test('mixin declarations retain native CSS values and escaping', () => {
    const declarations = [
        'margin: 1px 2rem 3% 4vh',
        'width: calc(100% - 1px)',
        'color: var(--color, rgb(255 0 0 / 50%))',
        'padding: env(safe-area-inset-top, 1px)',
        'color: light-dark(red, blue)',
        'color: color(display-p3 1 0.2 0 / 0.5)',
        'color: oklch(60% 0.1 30)',
        'background: linear-gradient(45deg, red, blue)',
        'background-image: url("assets/a b.svg")',
        'content: "a \\"quoted\\" string\\\\end"',
        'transition: opacity 200ms ease, transform 1s linear',
        '--custom: [one, two] { three: four; five: six }',
        '--empty: ',
        'grid-template-columns: [start] 1fr [end]',
        'font-family: "Example Font", sans-serif',
        'color: red !important',
    ]
    for (const declaration of declarations) {
        const expected = transform({ filename: 'test.css', code: Buffer.from(`a { ${declaration}; }`) }).code.toString()
        assert.equal(compile(`@define example { ${declaration}; } a { @apply example; }`), expected, declaration)
    }
})

test('parameters preserve complete values, defaults, and nested substitutions', () => {
    const source = `
        @define child(space, color) { margin: $space; color: $color; }
        @define parent(space: 1px 2px, color: var(--color, blue)) {
            @apply child($space, $color);
            width: calc(100% - $space);
            background: linear-gradient($color, red);
        }
        a { @apply parent(2px, var(--accent, green)); }
        b { @apply child(1px 2px, light-dark(red, blue)); }
    `
    const expected = `
        a {
            margin: 2px; color: var(--accent, green); width: calc(100% - 2px);
            background: linear-gradient(var(--accent, green), red);
        }
        b { margin: 1px 2px; color: light-dark(red, blue); }
    `
    assert.equal(compile(source), transform({ filename: 'test.css', code: Buffer.from(expected) }).code.toString())
    assert.match(compile('@define x(v: 1px 2px) { margin: $v; } a { @apply x; }'), /margin: 1px 2px;/u)
})

test('nested applications accept bare names and preserve important declarations', () => {
    const result = compile(`
        @define leaf { color: red !important; }
        @define parent { @apply leaf; color: blue; }
        a { @apply parent; }
    `)
    assert.equal(result, transform({
        filename: 'test.css',
        code: Buffer.from('a { color: blue; color: red !important; }'),
    }).code.toString())
})

test('mixin expansion preserves cascade order and selector specificity without wrappers', () => {
    const result = compile('@define x { color: red; } a, #b { color: blue; @apply x; color: green; }')
    assert.doesNotMatch(result, /@layer|&|:is\(/u)
    assert.match(result, /a, #b \{\s*color: #00f;\s*color: red;\s*color: green;\s*\}/u)
})

test('expansion works inside media queries and nested style rules with browser targets', () => {
    const result = transform({
        code: Buffer.from('@define x { margin: 1px 2px; } @media screen { a { & > b { @apply x; } } }'),
        visitor: createVisitor(),
        targets: { chrome: 100 << 16 },
        minify: true,
        sourceMap: true,
        filename: 'nested.css',
    })
    assert.equal(result.code.toString(), '@media screen{a>b{margin:1px 2px}}')
    assert.ok(result.map)
})

test('mixin syntax errors fail explicitly with source locations', () => {
    /** @type {Array<[string, RegExp]>} */
    const cases = [
        ['@define x { color: red; } @define x { color: blue; }', /mixin already defined: x/u],
        ['@define x(a, a) { color: red; }', /duplicate parameter: a/u],
        ['@define x(a:) { color: red; }', /expected a default value/u],
        ['@define x(a,) { color: red; }', /expected a value for every argument/u],
        ['@define x garbage { color: red; }', /expected exactly one mixin/u],
        ['@define x { color red; }', /expected a colon/u],
        ['@define x { color:; }', /expected a value for property/u],
        ['@define x { @unknown y(); }', /unexpected at-rule/u],
        ['@define x { color: red; } a { @apply x {} }', /unexpected block/u],
        ['@define x { color: red; } @apply x;', /inside a style rule/u],
        ['@define x { color: red; } a { @apply x; } @apply x;', /inside a style rule/u],
        ['@define x { color: red; } a { b { @apply x; } } @apply x;', /inside a style rule/u],
        ['@define x(a) { color: $a; } a { @apply x(red,); }', /expected a value for every argument/u],
        ['@define x { color: $missing; } a { @apply x; }', /unexpected variable/u],
        ['@define x(unused) { color: red; } a { @apply x; }', /expected a value for argument/u],
    ]
    for (const [source, expected] of cases) {
        assert.throws(() => compile(source), expected)
        assert.throws(() => compile(source), /(?:define|apply) at \d+:\d+:/u)
    }
    assert.throws(() => compile('\n@define broken { color red; }'), /define at 2:1:/u)
})

test('failed expansion does not poison subsequent compilations', () => {
    assert.throws(() => compile('@define x { @apply x; } a { @apply x; }'), /circular/u)
    assert.match(compile('@define x { color: red; } a { @apply x; }'), /color: red/u)
    assert.throws(() => compile('a { @apply x; }'), /mixin not found/u)
})

test('factory creates independent visitor instances', () => {
    const first = createVisitor()
    const second = createVisitor()
    assert.notEqual(first, second)
    transform({ filename: 'test.css', code: Buffer.from('@define x { color: red; }'), visitor: first })
    assert.throws(
        () => transform({ filename: 'test.css', code: Buffer.from('a { @apply x; }'), visitor: second }),
        /mixin not found/u
    )
})

test('inline assets work inside mixins and filesystem failures remain visible', () => {
    assert.ok(compile(`@define x { background: inline(${JSON.stringify(assetPath)}, "application/json"); }
        a { @apply x; }`).includes(`data:application/json;base64,${assetData}`))
    assert.throws(() => compile('a { background: inline("nonexistent-asset.svg"); }'), /ENOENT/u)
})

test('Vite warning filter suppresses only this package at-rules and forwards options and context', () => {
    /** @type {Array<[string, { clear?: boolean, timestamp?: boolean } | undefined]>} */
    const messages = []
    const logger = {
        /** @param {string} message @param {{ clear?: boolean, timestamp?: boolean }} [options] */
        warn(message, options) {
            assert.equal(this, logger)
            messages.push([message, options])
        },
    }
    vitePluginDisableWarnings.configResolved({ logger })
    logger.warn('[vite:css][lightningcss] Unknown at rule: @define\nfile.css:1:1')
    logger.warn('[vite:css][lightningcss] Unknown at rule: @apply\r\nfile.css:2:1')
    const options = { timestamp: true }
    for (const message of [
        '[vite:css][lightningcss] Unknown at rule: @apply-other',
        '[vite:css][lightningcss] Unknown at rule: @media',
        'Another plugin: Unknown at rule: @define',
        'An unrelated warning',
    ]) {
        logger.warn(message, options)
    }
    assert.equal(messages.length, 4)
    assert.ok(messages.every(([, forwardedOptions]) => forwardedOptions === options))
})
