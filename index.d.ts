import type { CustomAtRules, Visitor } from 'lightningcss'

declare const visitor: Visitor<CustomAtRules>
export default visitor

/** Create independent state for each concurrent compilation or bundler. */
export function createVisitor(): Visitor<CustomAtRules>

/** Suppress only Vite's unknown-at-rule warnings for @define and @apply. */
export const vitePluginDisableWarnings: {
    name: string
    configResolved(config: {
        logger: {
            warn(message: string, options?: { clear?: boolean; timestamp?: boolean }): void
        }
    }): void
}
