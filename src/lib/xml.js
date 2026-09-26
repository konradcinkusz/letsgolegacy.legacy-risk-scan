// A small, strict XML reader for MSBuild project files and packages.config.
//
// Why hand-rolled rather than DOMParser or a library: the parsers must be pure functions
// that run identically in the browser and under `node --test`, and the page ships no
// third-party code. The subset needed is small and stable — elements, attributes, text,
// comments, CDATA, processing instructions and a DOCTYPE to skip — which is the narrow
// case REPO-BASELINE.md §4b allows hand-rolling for.
//
// Deliberately NOT supported: entity declarations. Only the five predefined entities and
// numeric character references are decoded, so there is no entity expansion at all (no
// XXE, no "billion laughs"). Malformed input throws XmlError with a line and column.

export class XmlError extends Error {
  /**
   * @param {string} reason machine-readable reason code (see messages.js)
   * @param {{line:number,column:number}} position 1-based
   * @param {Record<string,string>} [params]
   */
  constructor(reason, position, params = {}) {
    super(`${reason} at ${position.line}:${position.column}`);
    this.name = 'XmlError';
    this.reason = reason;
    this.line = position.line;
    this.column = position.column;
    this.params = params;
  }
}

const NAME_START = /[A-Za-z_:À-￿]/;
const NAME_CHAR = /[A-Za-z0-9_:.\-·À-￿]/;
const PREDEFINED = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

function lineIndex(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return (offset) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo + 1, column: offset - starts[lo] + 1 };
  };
}

/**
 * @typedef {{ name: string, localName: string, attrs: Record<string,string>,
 *             children: XmlElement[], text: string, offset: number }} XmlElement
 */

/**
 * Parses an XML document and returns its root element.
 * @param {string} input
 * @returns {XmlElement}
 */
export function parseXml(input) {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const pos = lineIndex(text);
  const fail = (reason, offset, params) => {
    throw new XmlError(reason, pos(Math.min(offset, text.length)), params);
  };

  const decode = (raw, offset) =>
    raw.replace(/&([^;&\s<]*);?/g, (match, body, rel) => {
      if (!match.endsWith(';')) fail('bad-entity', offset + rel, { entity: match });
      if (body in PREDEFINED) return PREDEFINED[body];
      const num = /^#x([0-9A-Fa-f]+)$/.exec(body) || /^#([0-9]+)$/.exec(body);
      if (num) {
        const code = parseInt(num[1], body[1] === 'x' ? 16 : 10);
        if (code > 0 && code <= 0x10ffff) return String.fromCodePoint(code);
      }
      return fail('bad-entity', offset + rel, { entity: match });
    });

  /** @type {XmlElement[]} */
  const stack = [];
  /** @type {XmlElement|null} */
  let root = null;
  let i = 0;

  const expectEnd = (terminator, reason, from) => {
    const end = text.indexOf(terminator, i);
    if (end < 0) fail(reason, from);
    return end;
  };

  while (i < text.length) {
    const lt = text.indexOf('<', i);
    const chunkEnd = lt < 0 ? text.length : lt;
    if (chunkEnd > i) {
      const chunk = text.slice(i, chunkEnd);
      if (stack.length) stack[stack.length - 1].text += decode(chunk, i);
      else if (chunk.trim()) fail('text-outside-root', i + chunk.search(/\S/));
      i = chunkEnd;
      continue;
    }

    // text[i] === '<'
    if (text.startsWith('<!--', i)) {
      i = expectEnd('-->', 'unterminated-comment', i) + 3;
    } else if (text.startsWith('<![CDATA[', i)) {
      if (!stack.length) fail('text-outside-root', i);
      const end = expectEnd(']]>', 'unterminated-cdata', i);
      stack[stack.length - 1].text += text.slice(i + 9, end);
      i = end + 3;
    } else if (text.startsWith('<?', i)) {
      i = expectEnd('?>', 'unterminated-pi', i) + 2;
    } else if (text.startsWith('<!', i)) {
      // DOCTYPE (possibly with an internal subset, which is skipped, never interpreted).
      const bracket = text.indexOf('[', i);
      const close = text.indexOf('>', i);
      if (close < 0) fail('unexpected-eof', i);
      i = bracket >= 0 && bracket < close ? expectEnd(']>', 'unexpected-eof', i) + 2 : close + 1;
    } else if (text[i + 1] === '/') {
      const start = i;
      i += 2;
      const nameStart = i;
      while (i < text.length && NAME_CHAR.test(text[i])) i++;
      const name = text.slice(nameStart, i);
      while (i < text.length && /\s/.test(text[i])) i++;
      if (text[i] !== '>') fail('bad-tag', i);
      i++;
      const open = stack.pop();
      if (!open) fail('unexpected-close', start, { found: name });
      if (open.name !== name) fail('mismatched-tag', start, { expected: open.name, found: name });
    } else {
      const start = i;
      i++;
      if (!NAME_START.test(text[i] || '')) fail('bad-tag', i);
      const nameStart = i;
      while (i < text.length && NAME_CHAR.test(text[i])) i++;
      const name = text.slice(nameStart, i);
      /** @type {Record<string,string>} */
      const attrs = {};
      let selfClosing = false;
      for (;;) {
        const wsStart = i;
        while (i < text.length && /\s/.test(text[i])) i++;
        if (i >= text.length) fail('unexpected-eof', start);
        if (text[i] === '>') { i++; break; }
        if (text[i] === '/' && text[i + 1] === '>') { i += 2; selfClosing = true; break; }
        if (i === wsStart || !NAME_START.test(text[i])) fail('bad-attribute', i, { element: name });
        const attrStart = i;
        while (i < text.length && NAME_CHAR.test(text[i])) i++;
        const attrName = text.slice(attrStart, i);
        while (/\s/.test(text[i] || '')) i++;
        if (text[i] !== '=') fail('bad-attribute', i, { element: name });
        i++;
        while (/\s/.test(text[i] || '')) i++;
        const quote = text[i];
        if (quote !== '"' && quote !== "'") fail('bad-attribute', i, { element: name });
        const valueEnd = text.indexOf(quote, i + 1);
        if (valueEnd < 0) fail('unexpected-eof', i);
        const rawValue = text.slice(i + 1, valueEnd);
        if (rawValue.includes('<')) fail('bad-attribute', i + 1 + rawValue.indexOf('<'), { element: name });
        attrs[attrName] = decode(rawValue, i + 1);
        i = valueEnd + 1;
      }
      const colon = name.indexOf(':');
      /** @type {XmlElement} */
      const element = {
        name,
        localName: colon >= 0 ? name.slice(colon + 1) : name,
        attrs,
        children: [],
        text: '',
        offset: start,
      };
      if (stack.length) stack[stack.length - 1].children.push(element);
      else if (root) fail('multiple-roots', start);
      else root = element;
      if (!selfClosing) stack.push(element);
    }
  }

  if (stack.length) {
    const open = stack[stack.length - 1];
    fail('unclosed-tag', open.offset, { name: open.name });
  }
  if (!root) fail('no-root', 0);
  return root;
}

// ── Query helpers ────────────────────────────────────────────────────────────
// MSBuild treats element and attribute names case-insensitively in practice (hand-edited
// project files do contain `include=` and `<version>`), so the helpers do too.

const eq = (a, b) => a.toLowerCase() === b.toLowerCase();

/** Direct children with the given local name. */
export function childElements(el, localName) {
  return el.children.filter((c) => eq(c.localName, localName));
}

/** All descendants (document order) with the given local name. */
export function descendants(el, localName) {
  const out = [];
  const walk = (node) => {
    for (const c of node.children) {
      if (eq(c.localName, localName)) out.push(c);
      walk(c);
    }
  };
  walk(el);
  return out;
}

/** Attribute value by case-insensitive name, or undefined. */
export function attr(el, name) {
  for (const [k, v] of Object.entries(el.attrs)) if (eq(k, name)) return v;
  return undefined;
}

/** Trimmed text content of the first child element with the given name, or undefined. */
export function childText(el, localName) {
  const c = childElements(el, localName)[0];
  return c ? c.text.trim() : undefined;
}
