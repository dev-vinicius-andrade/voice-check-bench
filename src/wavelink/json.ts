// Lossless JSON tree for Wave Link Settings.json and the formatting-preserving writer (port of dump_settings in
// tools/apply-reaplugs.py). Keeps key order (also integer-like keys), duplicate keys and number literals exactly.
// Framework-free; browser and Node.

export type JNode =
  | { t: 'obj'; entries: [string, JNode][] }
  | { t: 'arr'; items: JNode[] }
  | { t: 'str'; v: string }
  | { t: 'num'; raw: string }
  | { t: 'bool'; v: boolean }
  | { t: 'null' }

/** Line ending, indent, escaping style, trailing newline and BOM of the original text. */
export interface JsonFormat {
  nl: '\r\n' | '\n'
  indent: string | null
  dotnet: boolean
  trailingNl: boolean
  bom: boolean
}

const BOM = '\uFEFF'
const WS = new Set([' ', '\t', '\n', '\r'])
const NUM = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y
const ESC: Record<string, string> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' }

/** Strict JSON parse into a lossless tree. Throws SyntaxError on invalid JSON. A leading BOM is ignored. */
export function parseTree(text: string): JNode {
  const s = text.startsWith(BOM) ? text.slice(1) : text
  let i = 0
  const fail = (what: string): never => {
    throw new SyntaxError(`Invalid JSON at ${i}: ${what}`)
  }
  const ws = () => {
    while (i < s.length && WS.has(s[i])) i++
  }
  const str = (): string => {
    let out = ''
    i++ // opening quote
    for (;;) {
      if (i >= s.length) fail('unterminated string')
      const c = s[i++]
      if (c === '"') return out
      if (c === '\\') {
        const e = s[i++]
        if (e === 'u') {
          const hex = s.slice(i, i + 4)
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail('bad \\u escape')
          out += String.fromCharCode(parseInt(hex, 16))
          i += 4
        } else if (e !== undefined && e in ESC) out += ESC[e]
        else fail('bad escape')
      } else if (c < ' ') fail('control character in string')
      else out += c
    }
  }
  const value = (): JNode => {
    ws()
    const c = s[i]
    if (c === '{') {
      i++
      const entries: [string, JNode][] = []
      ws()
      if (s[i] === '}') {
        i++
        return { t: 'obj', entries }
      }
      for (;;) {
        ws()
        if (s[i] !== '"') fail('expected key')
        const k = str()
        ws()
        if (s[i++] !== ':') fail('expected :')
        entries.push([k, value()])
        ws()
        const d = s[i++]
        if (d === '}') return { t: 'obj', entries }
        if (d !== ',') fail('expected , or }')
      }
    }
    if (c === '[') {
      i++
      const items: JNode[] = []
      ws()
      if (s[i] === ']') {
        i++
        return { t: 'arr', items }
      }
      for (;;) {
        items.push(value())
        ws()
        const d = s[i++]
        if (d === ']') return { t: 'arr', items }
        if (d !== ',') fail('expected , or ]')
      }
    }
    if (c === '"') return { t: 'str', v: str() }
    for (const [word, node] of [['true', { t: 'bool', v: true }], ['false', { t: 'bool', v: false }], ['null', { t: 'null' }]] as const) {
      if (s.startsWith(word, i)) {
        i += word.length
        return node
      }
    }
    NUM.lastIndex = i
    const m = NUM.exec(s)
    if (!m) return fail('unexpected token')
    i += m[0].length
    return { t: 'num', raw: m[0] }
  }
  const root = value()
  ws()
  if (i !== s.length) fail('trailing data')
  return root
}

/** Format of the original text (detect_format in the Python tool, plus the BOM). */
export function detectFormat(text: string): JsonFormat {
  const bom = text.startsWith(BOM)
  const raw = bom ? text.slice(1) : text
  const nl = raw.includes('\r\n') ? '\r\n' : '\n'
  let indent: string | null = null
  const first = raw.indexOf('\n')
  if (first !== -1) {
    const line = raw.slice(first + 1).split('\n', 1)[0]
    const ws = /^[ \t]*/.exec(line)?.[0] ?? ''
    indent = ws || null
  }
  const dotnet = raw.includes('\\u0022') || raw.includes('\\u002B') // System.Text.Json default escaping
  return { nl, indent, dotnet, trailingNl: raw.endsWith('\n'), bom }
}

const SHORT: Record<string, string> = { '"': '\\"', '\\': '\\\\', '\n': '\\n', '\r': '\\r', '\t': '\\t', '\b': '\\b', '\f': '\\f' }
const DOTNET_ESCAPED = new Set(['"', "'", '+', '<', '>', '&', '`'])
const hex4 = (n: number): string => '\\u' + n.toString(16).toUpperCase().padStart(4, '0')

/** A string the way .NET System.Text.Json writes it by default (", +, non-ASCII as \uXXXX per UTF-16 unit). */
export function dotnetString(s: string): string {
  let out = '"'
  for (let k = 0; k < s.length; k++) {
    const c = s[k]
    const o = s.charCodeAt(k)
    if (DOTNET_ESCAPED.has(c)) out += hex4(o)
    else if (c in SHORT) out += SHORT[c]
    else if (o < 0x20 || o >= 0x7f) out += hex4(o)
    else out += c
  }
  return out + '"'
}

/** Text of the tree in the original format (dump_settings). Number literals are written exactly as read. */
export function dumpTree(node: JNode, fmt: JsonFormat): string {
  const { nl, indent: ind, dotnet } = fmt
  const strOut = dotnet ? dotnetString : (v: string) => JSON.stringify(v)
  const rec = (o: JNode, level: number): string => {
    switch (o.t) {
      case 'str':
        return strOut(o.v)
      case 'num':
        return o.raw
      case 'bool':
        return o.v ? 'true' : 'false'
      case 'null':
        return 'null'
      default: {
        const isObj = o.t === 'obj'
        const [op, cl] = isObj ? ['{', '}'] : ['[', ']']
        const sep = ind === null ? (dotnet ? ':' : ': ') : ': '
        const parts = isObj ? o.entries.map(([k, v]) => strOut(k) + sep + rec(v, level + 1)) : o.items.map((v) => rec(v, level + 1))
        if (!parts.length) return op + cl
        // Python json.dumps without indent separates items with ', '; the .NET writer uses ','
        if (ind === null) return op + parts.join(dotnet ? ',' : ', ') + cl
        const pad = ind.repeat(level + 1)
        return op + nl + parts.map((p) => pad + p).join(',' + nl) + nl + ind.repeat(level) + cl
      }
    }
  }
  return (fmt.bom ? BOM : '') + rec(node, 0) + (fmt.trailingNl ? nl : '')
}

/** Property of an object node (the last one when a key repeats, like a JSON object). */
export function prop(o: JNode | undefined, key: string): JNode | undefined {
  if (!o || o.t !== 'obj') return undefined
  for (let k = o.entries.length - 1; k >= 0; k--) if (o.entries[k][0] === key) return o.entries[k][1]
  return undefined
}

/** Sets a property (replacing the last one with that key, else appending). */
export function setProp(o: JNode, key: string, v: JNode): void {
  if (o.t !== 'obj') return
  for (let k = o.entries.length - 1; k >= 0; k--) {
    if (o.entries[k][0] === key) {
      o.entries[k][1] = v
      return
    }
  }
  o.entries.push([key, v])
}
