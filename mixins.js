import { transformStyleAttribute } from 'lightningcss'

/**
 * @typedef {import('lightningcss').TokenOrValue} TokenOrValue
 * @typedef {import('lightningcss').UnknownAtRule} UnknownAtRule
 * @typedef {import('lightningcss').ReturnedDeclaration} ReturnedDeclaration
 * @typedef {import('lightningcss').Visitor<import('lightningcss').CustomAtRules>} CustomVisitor
 * @typedef {{ name: string, args: TokenOrValue[][] }} Call
 * @typedef {{ name: string, fallback: TokenOrValue[] }} Parameter
 * @typedef {{ type: 'declaration', name: string, value: TokenOrValue[] } | { type: 'apply', call: Call }} Statement
 * @typedef {{ name: string, params: Parameter[], statements: Statement[] }} Mixin
 */

/** @param {TokenOrValue | undefined} item */
const isWhitespace = (item) => item?.type === 'token' && ['white-space', 'comment'].includes(item.value.type)

/** @param {TokenOrValue[]} tokens */
const trim = (tokens) => {
    let start = 0
    let end = tokens.length
    while (start < end && isWhitespace(tokens[start])) start++
    while (end > start && isWhitespace(tokens[end - 1])) end--
    return tokens.slice(start, end)
}

/**
 * @param {TokenOrValue | undefined} item
 * @param {import('lightningcss').Token['type']} type
 */
const isToken = (item, type) => item?.type === 'token' && item.value.type === type

/** @param {TokenOrValue | undefined} item */
const identifier = (item) => {
    if (item?.type === 'token' && item.value.type === 'ident') return item.value.value
    if (item?.type === 'dashed-ident') return item.value
    throw new Error('expected an identifier')
}

/**
 * Functions are already grouped by Lightning CSS; brackets remain flat tokens.
 * @param {TokenOrValue[]} tokens
 * @param {'comma' | 'semicolon'} separator
 * @returns {TokenOrValue[][]}
 */
const split = (tokens, separator) => {
    /** @type {TokenOrValue[][]} */
    const result = []
    let start = 0
    let depth = 0
    for (let index = 0; index < tokens.length; index++) {
        const item = tokens[index]
        if (item?.type !== 'token') continue
        if (['parenthesis-block', 'square-bracket-block', 'curly-bracket-block'].includes(item.value.type)) depth++
        if (['close-parenthesis', 'close-square-bracket', 'close-curly-bracket'].includes(item.value.type)) depth--
        if (depth === 0 && item.value.type === separator) {
            result.push(trim(tokens.slice(start, index)))
            start = index + 1
        }
    }
    result.push(trim(tokens.slice(start)))
    return result
}

/** @param {TokenOrValue[]} tokens @returns {Call} */
const parseCall = (tokens) => {
    const items = trim(tokens)
    if (items.length !== 1) throw new Error('expected exactly one mixin name or function')
    const item = items[0]
    if (item?.type !== 'function') return { name: identifier(item), args: [] }
    const args = trim(item.value.arguments).length ? split(item.value.arguments, 'comma') : []
    if (args.some((arg) => arg.length === 0)) throw new Error('expected a value for every argument')
    return { name: item.value.name, args }
}

/** @param {TokenOrValue[][]} args @returns {Parameter[]} */
const parseParameters = (args) => {
    const names = new Set()
    return args.map((arg) => {
        const name = identifier(arg[0])
        if (names.has(name)) throw new Error(`duplicate parameter: ${name}`)
        names.add(name)
        const rest = trim(arg.slice(1))
        if (rest.length && !isToken(rest[0], 'colon')) throw new Error(`expected a colon after parameter: ${name}`)
        const fallback = trim(rest.slice(1))
        if (rest.length && !fallback.length) throw new Error(`expected a default value for parameter: ${name}`)
        return { name, fallback }
    })
}

/** @param {TokenOrValue[]} block @returns {Statement[]} */
const parseBlock = (block) => split(block, 'semicolon').filter((tokens) => tokens.length).map((tokens) => {
    const first = tokens[0]
    if (first?.type === 'token' && first.value.type === 'at-keyword') {
        if (first.value.value !== 'apply') throw new Error(`unexpected at-rule in mixin: @${first.value.value}`)
        return { type: 'apply', call: parseCall(tokens.slice(1)) }
    }
    const name = identifier(first)
    const rest = trim(tokens.slice(1))
    if (!isToken(rest[0], 'colon')) throw new Error(`expected a colon after property: ${name}`)
    const value = trim(rest.slice(1))
    if (!value.length && !name.startsWith('--')) throw new Error(`expected a value for property: "${name}"`)
    return { type: 'declaration', name, value }
})

/**
 * Keep values as native tokens, including function arguments and variable fallbacks.
 * @param {TokenOrValue[]} tokens
 * @param {Map<string, TokenOrValue[]>} bindings
 * @returns {TokenOrValue[]}
 */
const substitute = (tokens, bindings) => {
    /** @type {TokenOrValue[]} */
    const result = []
    for (let index = 0; index < tokens.length; index++) {
        const item = tokens[index]
        if (!item) continue
        if (item.type === 'token' && item.value.type === 'delim' && item.value.value === '$') {
            const name = identifier(tokens[++index])
            const value = bindings.get(name)
            if (!value) throw new Error(`unexpected variable: "${name}"`)
            result.push(...value)
        } else if (item.type === 'function') {
            result.push({ ...item, value: { ...item.value, arguments: substitute(item.value.arguments, bindings) } })
        } else if (item.type === 'var') {
            result.push({
                ...item,
                value: {
                    // Lightning CSS emits null here but requires omission when deserializing.
                    name: item.value.name.from ? item.value.name : { ident: item.value.name.ident },
                    ...(item.value.fallback ? { fallback: substitute(item.value.fallback, bindings) } : {}),
                },
            })
        } else if (item.type === 'env') {
            const name = item.value.name
            result.push({
                ...item,
                value: {
                    ...item.value,
                    name: name.type === 'custom' && !name.from ? { type: 'custom', ident: name.ident } : name,
                    ...(item.value.fallback ? { fallback: substitute(item.value.fallback, bindings) } : {}),
                },
            })
        } else if (item.type === 'unresolved-color') {
            const color = item.value
            result.push({
                ...item,
                value: color.type === 'light-dark'
                    ? { ...color, light: substitute(color.light, bindings), dark: substitute(color.dark, bindings) }
                    : { ...color, alpha: substitute(color.alpha, bindings) },
            })
        } else {
            result.push(item)
        }
    }
    return result
}

/**
 * Use Lightning CSS's serializer rather than reimplementing CSS escaping and colors.
 * @param {TokenOrValue[]} value
 */
const stringify = (value) => {
    const result = transformStyleAttribute({
        code: Buffer.from('--value: 0'),
        visitor: {
            Declaration() {
                return { property: 'custom', value: { name: '--value', value } }
            },
        },
    }).code.toString()
    return result.slice(result.indexOf(':') + 1).replace(/;$/u, '').trim()
}

/** @param {TokenOrValue} property */
export const stringifyProperty = (property) => stringify(substitute([property], new Map()))

/** @param {import('lightningcss').CssColor} color */
export const stringifyColor = (color) => stringifyProperty({ type: 'color', value: color })

/**
 * @param {string} name
 * @returns {name is Extract<ReturnedDeclaration, { raw: string }>['property']}
 */
const isPropertyName = (name) => /^[-_a-z]/u.test(name)

/** @returns {CustomVisitor} */
export const createMixinVisitor = () => {
    /** @type {Map<string, Mixin>} */
    const mixins = new Map()
    let styleDepth = 0

    /**
     * @param {Call} call
     * @param {string[]} ancestors
     * @returns {import('lightningcss').DeclarationBlock<ReturnedDeclaration>}
     */
    const expand = (call, ancestors = []) => {
        const mixin = mixins.get(call.name)
        if (!mixin) throw new Error(`mixin not found: ${call.name}`)
        if (ancestors.includes(call.name)) {
            throw new Error(`circular mixin application: ${[...ancestors, call.name].join(' -> ')}`)
        }
        if (call.args.length > mixin.params.length) {
            throw new Error(`mixin ${call.name} expected at most ${mixin.params.length} arguments, got ${call.args.length}`)
        }
        /** @type {Map<string, TokenOrValue[]>} */
        const bindings = new Map()
        mixin.params.forEach((param, index) => {
            const value = substitute(call.args[index] ?? param.fallback, bindings)
            if (!value.length) throw new Error(`expected a value for argument: "${param.name}"`)
            bindings.set(param.name, value)
        })
        /** @type {ReturnedDeclaration[]} */
        const declarations = []
        /** @type {ReturnedDeclaration[]} */
        const importantDeclarations = []
        for (const statement of mixin.statements) {
            if (statement.type === 'apply') {
                const nested = expand({
                    name: statement.call.name,
                    args: statement.call.args.map((arg) => substitute(arg, bindings)),
                }, [...ancestors, call.name])
                declarations.push(...(nested.declarations ?? []))
                importantDeclarations.push(...(nested.importantDeclarations ?? []))
                continue
            }
            let value = trim(substitute(statement.value, bindings))
            const last = value.at(-1)
            let important = false
            if (last?.type === 'token' && last.value.type === 'ident' && last.value.value.toLowerCase() === 'important') {
                const before = trim(value.slice(0, -1))
                const bang = before.at(-1)
                if (bang?.type === 'token' && bang.value.type === 'delim' && bang.value.value === '!') {
                    important = true
                    value = trim(before.slice(0, -1))
                }
            }
            if (!value.length && !statement.name.startsWith('--')) {
                throw new Error(`expected a value for property: "${statement.name}"`)
            }
            const name = statement.name.startsWith('--') ? statement.name : statement.name.toLowerCase()
            /** @type {ReturnedDeclaration} */
            const declaration = isPropertyName(name)
                ? { property: name, raw: stringify(value) }
                : { property: 'custom', value: { name, value } }
            ;(important ? importantDeclarations : declarations).push(declaration)
        }
        return { declarations, importantDeclarations }
    }

    /**
     * @param {UnknownAtRule} rule
     * @param {() => import('lightningcss').ReturnedRule[]} callback
     */
    const atRule = (rule, callback) => {
        try {
            return callback()
        } catch (error) {
            throw new Error(`${rule.name} at ${rule.loc.line + 1}:${rule.loc.column}: ${error}`, { cause: error })
        }
    }

    return {
        StyleSheet() {
            mixins.clear()
            styleDepth = 0
        },
        Rule: {
            style() {
                styleDepth++
            },
            unknown: {
                define(rule) {
                    return atRule(rule, () => {
                        if (!rule.block) throw new Error('expected a block')
                        const call = parseCall(rule.prelude)
                        if (mixins.has(call.name)) throw new Error(`mixin already defined: ${call.name}`)
                        mixins.set(call.name, {
                            name: call.name,
                            params: parseParameters(call.args),
                            statements: parseBlock(rule.block),
                        })
                        return []
                    })
                },
                apply(rule) {
                    return atRule(rule, () => {
                        if (rule.block != null) throw new Error('unexpected block')
                        if (!styleDepth) throw new Error('@apply must be inside a style rule')
                        return [{
                            type: 'nested-declarations',
                            value: { loc: rule.loc, declarations: expand(parseCall(rule.prelude)) },
                        }]
                    })
                },
            },
        },
        RuleExit(rule) {
            if (rule.type === 'style') styleDepth--
        },
    }
}

export default createMixinVisitor()
