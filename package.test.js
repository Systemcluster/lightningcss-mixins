import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

test('packed package works in an isolated runtime and TypeScript consumer', (context) => {
    const directory = fs.mkdtempSync(join(tmpdir(), 'lightningcss-mixins-package-'))
    context.after(() => fs.rmSync(directory, { recursive: true, force: true }))
    const npm = process.env.npm_execpath
    assert.ok(npm, 'run this test through npm run test:package')
    const output = execFileSync(process.execPath, [
        npm, 'pack', '--ignore-scripts', '--json', '--pack-destination', directory,
    ], { cwd: root, encoding: 'utf8' })
    const [packed] = JSON.parse(output)
    assert.deepEqual(packed.files.map((/** @type {{ path: string }} */ file) => file.path).sort(), [
        'LICENSE', 'README.md', 'index.d.ts', 'index.js', 'mixins.js', 'package.json',
    ])
    fs.writeFileSync(join(directory, 'package.json'), JSON.stringify({ private: true, type: 'module' }))
    execFileSync(process.execPath, [
        npm, 'install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--no-package-lock',
        join(directory, packed.filename), join(root, 'node_modules/lightningcss'),
    ], { cwd: directory, stdio: 'pipe' })
    execFileSync(process.execPath, ['--input-type=module', '--eval', `
        import assert from 'node:assert/strict'
        import visitor, { createVisitor, vitePluginDisableWarnings } from 'lightningcss-mixins'
        import { transform } from 'lightningcss'
        for (const current of [visitor, createVisitor()]) {
            const result = transform({
                filename: 'consumer.css',
                code: Buffer.from('@define x(v: 2px) { margin: $v; } a { @apply x; }'),
                visitor: current,
                minify: true,
            })
            assert.equal(result.code.toString(), 'a{margin:2px}')
        }
        assert.equal(typeof vitePluginDisableWarnings.configResolved, 'function')
    `], { cwd: directory, stdio: 'pipe' })
    const source = join(directory, 'consumer.ts')
    fs.writeFileSync(source, `
        import visitor, { createVisitor, vitePluginDisableWarnings } from 'lightningcss-mixins'
        import { transform } from 'lightningcss'
        transform({ filename: 'consumer.css', code: new Uint8Array(), visitor })
        transform({ filename: 'consumer.css', code: new Uint8Array(), visitor: createVisitor() })
        vitePluginDisableWarnings.configResolved({ logger: { warn(message: string) {} } })
    `)
    execFileSync(process.execPath, [
        require.resolve('typescript/bin/tsc'), '--ignoreConfig', '--noEmit', '--strict',
        '--skipLibCheck', '--module', 'NodeNext', '--target', 'ES2022',
        '--types', 'node', '--typeRoots', join(root, 'node_modules/@types'), source,
    ], { cwd: directory, stdio: 'pipe' })
})
