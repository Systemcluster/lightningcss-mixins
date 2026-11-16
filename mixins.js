/* lightningcss-plugin-env */

/**
 * @typedef {import("lightningcss").UnknownAtRule} UnknownAtRule
 * @typedef {import("lightningcss").ReturnedRule} ReturnedRule
 * @typedef {import("lightningcss").CustomAtRules} CustomAtRules
 * @typedef {import("lightningcss").Visitor<CustomAtRules>} CustomVisitor
 * @typedef {import("lightningcss").TokenOrValue} TokenOrValue
 * @typedef {import("lightningcss").Token} Token
 * @typedef {import("lightningcss").Location2} Location2
 * @typedef {import("lightningcss").CssColor} CssColor
 * @typedef {import("lightningcss").SystemColor} SystemColor
 * @typedef {import("lightningcss").ReturnedDeclaration} ReturnedDeclaration
 */

/**
 * @typedef {{
 *   name: string;
 *   params: [ReturnedDeclaration["property"] | null, TokenOrValue[]][];
 *   blocks: [ReturnedDeclaration["property"] | null, TokenOrValue[]][];
 *   loc: Location2;
 * }} Mixin
 */
export const createMixinVisitor = () => {
    /** @type {Map<ReturnedDeclaration["property"], Mixin>} */
    const mixins = new Map()
    /** @type {(rule: UnknownAtRule) => ReturnedRule[]} */
    const define = (rule) => {
        if (process.env.DEBUG) {
            console.trace('rule', rule.name, rule)
        }
        try {
            if (!rule.block || rule.block.length === 0) {
                throw new Error(`expected a block`)
            }
            const blocks = parseBlock(rule.block)
            let name
            /** @type {Mixin["params"]} */
            let params = []
            switch (rule.prelude[0]?.type) {
                case 'function': {
                    name = parseProperty(rule.prelude[0].value.name)
                    params = parseParams([rule.prelude[0]])
                    break
                }
                case 'token': {
                    switch (rule.prelude[0].value.type) {
                        case 'ident': {
                            name = parseProperty(rule.prelude[0].value.value)
                            break
                        }
                        default: {
                            throw new Error(`unexpected token: "${rule.prelude[0].value.type}"`)
                        }
                    }
                    break
                }
                default: {
                    throw new Error(`unexpected item: "${rule.prelude[0]?.type}"`)
                }
            }
            if (mixins.has(name)) {
                // console.error(`mixin already defined: ${name}`)
                return []
            }
            if (process.env.DEBUG) {
                console.trace(`registering mixin @${name}`, JSON.stringify({ params, blocks }))
            }
            const mixin = {
                name: name,
                params: params,
                blocks: blocks,
                loc: rule.loc,
            }
            mixins.set(name, mixin)
        } catch (error) {
            throw new Error(`${rule.name} at ${rule.loc.line}:${rule.loc.column}: ${error}`, {
                cause: error,
            })
        }
        return []
    }

    /** @type {(rule: UnknownAtRule) => ReturnedRule[]} */
    const apply = (rule) => {
        if (process.env.DEBUG) {
            console.trace('rule', rule.name, rule)
        }
        try {
            if (!rule.name) {
                throw new Error(`expected a name`)
            }
            if (rule.block?.length) {
                throw new Error(`unexpected block`)
            }
            let name
            /** @type {Mixin["params"]} */
            let params = []
            switch (rule.prelude[0]?.type) {
                case 'function': {
                    name = parseProperty(rule.prelude[0].value.name)
                    params = parseParams([rule.prelude[0]])
                    break
                }
                // @ts-expect-error fallthrough is intentional
                case 'token': {
                    if ('value' in rule.prelude[0].value && typeof rule.prelude[0].value.value === 'string') {
                        name = parseProperty(rule.prelude[0].value.value)
                        break
                    }
                }
                // eslint-disable-next-line no-fallthrough
                default: {
                    throw new Error(`unexpected item: "${rule.prelude[0]?.type}"`)
                }
            }
            const mixin = mixins.get(name)
            if (!mixin) {
                throw new Error(`mixin not found: ${name}`)
            }
            if (params.length > mixin.params.length) {
                throw new Error(`mixin ${name} expected at most ${mixin.params.length} arguments, got ${params.length}`)
            }
            if (process.env.DEBUG) {
                console.trace('mixin:', mixin, 'params:', params)
            }
            /**
             * @param {Mixin} mixin
             * @param {Mixin["params"]} params
             * @param {string[]} ancestors
             */
            const applyMixin = (mixin, params, ancestors = []) => {
                if (ancestors.includes(mixin.name)) {
                    throw new Error(`circular mixin application: ${[...ancestors, mixin.name].join(' -> ')}`)
                }
                const chain = [...ancestors, mixin.name]
                /** @type {ReturnedDeclaration[]} */
                const applied = []
                for (let index = 0; index < mixin.blocks.length; index++) {
                    const current = mixin.blocks[index]
                    if (!current) {
                        continue
                    }
                    const [name, value] = current
                    if (!name) {
                        const first = value[0]
                        if (!first) {
                            console.error(`declaration has no name or value`)
                            continue
                        }
                        let next
                        switch (first.type) {
                            case 'token': {
                                if (first.value.type === 'at-keyword') {
                                    switch (first.value.value) {
                                        case 'apply': {
                                            next = value[0]
                                            break
                                        }
                                        default: {
                                            throw new Error(`unexpected at-keyword: "${first.value.value}"`)
                                        }
                                    }
                                }
                                break
                            }
                            case 'function': {
                                next = first
                                break
                            }
                            default: {
                                break
                            }
                        }
                        if (!next) {
                            throw new Error(`expected a value in mixin: "${mixin.name}"`)
                        }
                        if (next.type !== 'function') {
                            throw new Error(`expected a function, got ${next.type}`)
                        }
                        const params = parseParams([next])
                        const ident = parseProperty(next.value.name)
                        const nested = mixins.get(ident)
                        if (!nested) {
                            throw new Error(`mixin not found: ${ident}`)
                        }
                        if (params.length > nested.params.length) {
                            throw new Error(`expected at most ${nested.params.length} arguments, got ${params.length}`)
                        }
                        applied.push(...applyMixin(nested, params, chain))
                    } else {
                        if (!value[0]) {
                            throw new Error(`expected a value for property: "${name}"`)
                        }
                        if (value.length === 1) {
                            applied.push({
                                property: name,
                                raw: stringifyProperty(value[0]),
                            })
                        } else if (
                            value.length === 2 &&
                            value[0]?.type === 'token' &&
                            value[0].value.type === 'delim' &&
                            value[0].value.value === '$' &&
                            value[1]?.type === 'token' &&
                            value[1].value.type === 'ident'
                        ) {
                            const ident = value[1].value.value
                            const param = mixin.params.findIndex((p) => p[0] === ident)
                            if (param === -1) {
                                throw new Error(
                                    `unexpected variable: "${ident}", expected one of: ${mixin.params.map((p) => p[0]).join(', ')}`
                                )
                            }
                            let arg = params[param]?.[0] ?? ''
                            if (!arg) {
                                const placeholder = mixin.params[param]?.[1]?.[0]
                                if (!placeholder) {
                                    throw new Error(`expected a value for argument: "${ident}"`)
                                }
                                arg = stringifyProperty(placeholder)
                            }
                            applied.push({
                                property: name,
                                raw: arg,
                            })
                        } else {
                            throw new Error(
                                `expected exactly one value for property: "${name}", got ${value.length}: ${JSON.stringify(value)}`
                            )
                        }
                    }
                }
                return applied
            }
            /** @type {ReturnedDeclaration[]} */
            const declarations = applyMixin(mixin, params).filter((x) => !!x)
            return [
                {
                    type: 'layer-block',
                    value: {
                        loc: rule.loc,
                        rules: [
                            {
                                type: 'style',
                                value: {
                                    loc: rule.loc,
                                    selectors: [[{ type: 'nesting' }]],
                                    declarations: {
                                        declarations,
                                    },
                                },
                            },
                        ],
                    },
                },
            ]
        } catch (error) {
            throw new Error(`${rule.name} at ${rule.loc.line}:${rule.loc.column}: ${error}`, {
                cause: error,
            })
        }
    }
    /** @type {CustomVisitor} */
    const visitor = {
        StyleSheet() {
            mixins.clear()
        },
        Rule: {
            unknown: {
                define,
                apply,
            },
        },
    }
    return visitor
}

/**
 * @param {string?} property
 * @param {boolean?} verify
 * @returns {ReturnedDeclaration["property"]}
 */
const parseProperty = (property, verify = true) => {
    if (!property) {
        throw new Error(`expected a property`)
    }
    if (verify && !/^[-_a-z@]/u.test(property)) {
        throw new Error(`invalid property: "${property}"`)
    }
    // @ts-ignore property has been validated
    return property
}
/**
 * @param {TokenOrValue[]} list
 * @param {Token["type"]} separator
 * @returns {Mixin["blocks"]}
 */
const parseDeclarationList = (list, separator) => {
    const split = list
        .reduce(
            /**
             * @param {Mixin["blocks"]} acc
             * @param {TokenOrValue} item
             * @returns {Mixin["blocks"]}
             */
            (acc, item) => {
                if (!item) {
                    return acc
                }
                const prev = acc.at(-1)
                switch (item.type) {
                    case 'token': {
                        switch (item.value.type) {
                            case 'white-space': {
                                break
                            }
                            case 'colon': {
                                const first = prev?.[1].shift()
                                if (!prev || !first) {
                                    throw new Error(`unexpected item in declaration: "colon", expected name`)
                                }
                                switch (first.type) {
                                    case 'token': {
                                        if (first.value.type === 'ident') {
                                            prev[0] = parseProperty(first.value.value)
                                        } else {
                                            throw new Error(`unexpected item in declaration: "${first.type}"`)
                                        }
                                        break
                                    }
                                    case 'function': {
                                        prev[0] = parseProperty(first.value.name)
                                        break
                                    }
                                    default: {
                                        throw new Error(`unexpected item in declaration: "${first.type}"`)
                                    }
                                }
                                break
                            }
                            case separator: {
                                if (!acc[0]) {
                                    const first = acc.shift()
                                    if (first) {
                                        if (first[0] || first[1].length > 0) {
                                            acc.push(first)
                                        }
                                    } else {
                                        throw new Error(`unexpected item in declaration: "${item.type}", expected name`)
                                    }
                                } else if (acc[0] || (acc[1] && acc[1].length > 0)) {
                                    acc.push([null, []])
                                }
                                break
                            }
                            default: {
                                acc.at(-1)?.[1].push(item)
                                break
                            }
                        }
                        break
                    }
                    default: {
                        if (prev) {
                            prev[1].push(item)
                        } else {
                            throw new Error(`unexpected item in declaration: "${item.type}", expected name`)
                        }
                        break
                    }
                }
                return acc
            },
            [[null, []]]
        )
        .filter(([name, value]) => name || value.length > 0)
    while (!split[0]?.[0] && split[0]?.[1].length === 0) {
        split.shift()
    }
    return split
}

/**
 * @param {TokenOrValue[]} block
 * @returns {Mixin["blocks"]}
 */
const parseBlock = (block) => {
    const split = parseDeclarationList(block, 'semicolon')
    for (const prev of split) {
        if (prev[0] || prev[1].length === 0) {
            continue
        }

        const first = prev?.[1].shift()
        if (!first) {
            throw new Error(`unexpected item in block: "colon", expected name`)
        }
        switch (first.type) {
            case 'token': {
                if (first.value.type === 'ident') {
                    prev[0] = parseProperty(first.value.value)
                } else if (first.value.type === 'at-keyword') {
                    //
                } else {
                    throw new Error(`unexpected token in block: "${first.value.type}"`)
                }
                break
            }
            case 'function': {
                prev[0] = parseProperty(first.value.name)
                break
            }
            default: {
                throw new Error(`unexpected item in block: "${first.type}"`)
            }
        }
    }
    return split
}

/**
 * @param {TokenOrValue[]} params
 * @returns {Mixin["params"]}
 * @satifies {(params: TokenOrValue[]): params.length === 1}
 */
const parseParams = (params) => {
    if (params.length !== 1 || !params[0]) {
        throw new Error(`expected exactly one argument, got ${params.length}`)
    }
    const param = params[0]
    if (param.type !== 'function') {
        if (param.type === 'token' && param.value.type === 'ident') {
            return [[parseProperty(param.value.value), []]]
        }
        throw new Error(`expected a function, got ${param.type}`)
    }
    const split = parseDeclarationList(param.value.arguments, 'comma')
    for (const prev of split) {
        if (prev[0] || prev[1].length === 0) {
            continue
        }

        const current = prev?.[1].shift()
        if (!current) {
            throw new Error(`unexpected item in params: "colon", expected name`)
        }
        switch (current.type) {
            case 'token': {
                switch (current.value.type) {
                    case 'ident': {
                        prev[0] = parseProperty(current.value.value, false)
                        while (prev[1].length > 0) {
                            const next = prev[1].shift()
                            if (!next) {
                                break
                            }
                            prev[0] += ', ' + stringifyProperty(next)
                        }
                        break
                    }
                    default: {
                        throw new Error(`unexpected token in params: "${current.value.type}"`)
                    }
                }
                break
            }
            case 'function': {
                prev[0] = parseProperty(current.value.name, false)
                break
            }
            default: {
                prev[0] = parseProperty(stringifyProperty(current), false)
            }
        }
    }
    return split
}

/**
 * Converts a token or value into a string.
 *
 * @param {TokenOrValue} property
 * @returns {string}
 */
export const stringifyProperty = (property) => {
    switch (property.type) {
        case 'token': {
            switch (property.value.type) {
                case 'ident':
                case 'white-space':
                case 'delim':
                case 'number':
                case 'function': {
                    return String(property.value.value)
                }
                case 'string': {
                    return `"${property.value.value}"`
                }
                case 'hash': {
                    return `#${property.value.value}`
                }
                case 'percentage': {
                    return `${property.value.value * 100}%`
                }
                case 'at-keyword': {
                    return `@${property.value.value}`
                }
                case 'comment': {
                    return `/*${property.value.value}*/`
                }
                case 'unquoted-url': {
                    return property.value.value
                }
                case 'colon': {
                    return `:`
                }
                case 'comma': {
                    return `,`
                }
                case 'semicolon': {
                    return `;`
                }
                default: {
                    throw new Error(`stringify: unexpected token: "${property.value.type}"`)
                }
            }
        }
        case 'function': {
            return `${property.value.name}(${property.value.arguments.map(stringifyProperty).join(', ')})`
        }
        case 'color': {
            return stringifyColor(property.value)
        }
        case 'url': {
            return `url("${property.value.url}")`
        }
        case 'var': {
            return `var(${property.value.name.ident}${property.value.fallback ? property.value.fallback?.map(stringifyProperty).join(', ') : ''})`
        }
        case 'time': {
            return `${property.value.value}${property.value.type === 'seconds' ? 's' : 'ms'}`
        }
        case 'dashed-ident': {
            return `--${property.value}`
        }
        default: {
            throw new Error(`stringify: unexpected property: "${property.type}"`)
        }
    }
}

/**
 * Converts a color into a string.
 *
 * @param {CssColor} color
 * @returns {string}
 */
export const stringifyColor = (color) => {
    if (typeof color === 'string') {
        return color
    }
    if (color.type === 'currentcolor') {
        return 'currentcolor'
    }
    if (color.type === 'light-dark') {
        return `light-dark(${color.light}, ${color.dark})`
    }
    /** @type {Exclude<CssColor, SystemColor>['type'][]} */
    const simple = ['rgb', 'hsl', 'hwb', 'lab', 'lch', 'srgb', 'xyz-d50', 'xyz-d65']
    for (const key of simple) {
        if (color.type === key) {
            const keys = [...key].filter((k) => /^[a-z]$/u.test(k)).map((k) => k)
            // @ts-ignore reading the keys from the color object property has been validated
            const values = keys.map((k) => color[k] ?? null).filter((v) => v !== null)
            return `${key}(${values.join(', ')}, ${color.alpha})`
        }
    }
    switch (color.type) {
        case 'srgb-linear': {
            return `srgb(${color.r} ${color.g} ${color.b} / ${color.alpha})`
        }
        case 'oklab': {
            return `oklab(${color.l} ${color.a} ${color.b} / ${color.alpha})`
        }
        case 'oklch': {
            return `oklch(${color.l} ${color.c} ${color.h} / ${color.alpha})`
        }
        case 'display-p3': {
            return `display-p3(${color.r} ${color.g} ${color.b} / ${color.alpha})`
        }
        case 'rec2020': {
            return `rec2020(${color.r} ${color.g} ${color.b} / ${color.alpha})`
        }
        case 'a98-rgb': {
            return `a98-rgb(${color.r} ${color.g} ${color.b} / ${color.alpha})`
        }
        case 'prophoto-rgb': {
            return `prophoto-rgb(${color.r} ${color.g} ${color.b} / ${color.alpha})`
        }
        default: {
            console.warn(`unknown color type "${color.type}" for color`, color)
            return JSON.stringify(color)
        }
    }
}

export default createMixinVisitor()
