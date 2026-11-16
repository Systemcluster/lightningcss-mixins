import fs from 'node:fs'
import { extname } from 'node:path'

import { composeVisitors } from 'lightningcss'

import { createMixinVisitor } from './mixins.js'

/**
 * @typedef {import("lightningcss").CustomAtRules} CustomAtRules
 * @typedef {import("lightningcss").Visitor<CustomAtRules>} CustomVisitor
 * @typedef {{ warn(message: string, options?: { clear?: boolean, timestamp?: boolean }): void }} Logger
 */

/**
 * @type {CustomVisitor}
 */
const inline = {
    Function: {
        /**
         * This function inlines a file as a data URL encoded in base64.
         * It takes the path to the file and an optional MIME type as arguments.
         *
         * The MIME type defaults to `image/ext` where `ext` is the extension of the file,
         * with the exception of some common extensions as seen below.
         * The path is relative to the project root, and can optionally start with `@` or `@/`.
         *
         * Example:
         * ```css
         * background: inline('path/to/image.svg');
         * ```
         */
        inline: (fn) => {
            const args = fn.arguments.filter((item) => item.type !== 'token' || !['white-space', 'comment'].includes(item.value.type))
            if (args[1]?.type === 'token' && args[1].value.type === 'comma' && args.length === 3) {
                args.splice(1, 1)
            }
            const arg = args[0]
            if (!arg || args.length > 2) {
                throw new Error(`expected 1 or 2 arguments, got ${args.length}`)
            }
            if (arg.type !== 'token' || arg.value.type !== 'string') {
                throw new Error(`expected argument 1 to be a string, got ${arg.type}`)
            }
            let path = arg.value.value
            if (path.startsWith('@/')) {
                path = path.slice(2)
            } else if (path.startsWith('@')) {
                path = path.slice(1)
            }
            let mime
            if (args.length === 2) {
                const dat = args[1]
                if (dat?.type !== 'token' || dat?.value.type !== 'string') {
                    throw new Error(`expected argument 2 to be a string, got ${dat?.type}`)
                }
                mime = dat.value.value
            } else {
                let ext = extname(path).slice(1).toLowerCase()
                switch (ext) {
                    case 'svg': {
                        ext = 'svg+xml'
                        break
                    }
                    case 'jpg': {
                        ext = 'jpeg'
                        break
                    }
                    case 'ico': {
                        ext = 'x-icon'
                        break
                    }
                }
                mime = `image/${ext}`
            }
            const buf = fs.readFileSync(path).toString('base64')
            return {
                raw: `url(${JSON.stringify(`data:${mime};base64,${buf}`)})`,
            }
        },
    },
}

export const createVisitor = () => composeVisitors([createMixinVisitor(), inline])

export default createVisitor()

export const vitePluginDisableWarnings = {
    name: 'lightningcss-mixin-warnings',
    /** @param {{ logger: Logger }} config */
    configResolved(config) {
        const warn = config.logger.warn.bind(config.logger)
        config.logger.warn = (message, options) => {
            if (/\[vite:css\]\[lightningcss\] Unknown at rule: @(?:define|apply)(?:\r?\n|$)/u.test(message)) {
                return
            }
            warn(message, options)
        }
    },
}
