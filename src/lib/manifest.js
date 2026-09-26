// The single entry point from pasted text to a parsed manifest.
//
// Every failure — empty input, a truncated paste, a web.config pasted by mistake — ends
// as a ScanError with a code the page turns into a Polish sentence. Nothing here throws
// anything else for malformed input; scan.js still guards against the unexpected.

import { ScanError } from './errors.js';
import { parseXml, XmlError } from './xml.js';
import { parseMsbuild } from './parsers/msbuild.js';
import { parsePackagesConfig } from './parsers/packages-config.js';
import { parseComposerJson, parseComposerLock } from './parsers/composer.js';
import { parsePackageJson } from './parsers/package-json.js';

/** Characters, not bytes: a project file is text, and 2 MB is far above any real one. */
export const MAX_INPUT_CHARS = 2 * 1024 * 1024;

/**
 * @typedef {{
 *   format: string,
 *   runtimes: Array<Record<string, any>>,
 *   packages: Array<Record<string, any>>,
 *   hints: Array<{code: string, params?: Record<string, any>}>
 * }} Manifest
 */

function positionOf(text, offset) {
  const before = text.slice(0, offset);
  const line = before.split('\n').length;
  return { line, column: offset - before.lastIndexOf('\n') };
}

/** Line and column from a JSON.parse error, across V8, SpiderMonkey and JavaScriptCore. */
export function jsonErrorPosition(message, text) {
  const lc = /line (\d+) column (\d+)/i.exec(message);
  if (lc) return { line: Number(lc[1]), column: Number(lc[2]) };
  const pos = /position (\d+)/i.exec(message);
  if (pos) return positionOf(text, Math.min(Number(pos[1]), text.length));
  if (/unexpected end/i.test(message)) return positionOf(text, text.length);
  return null;
}

function parseXmlManifest(text) {
  let root;
  try {
    root = parseXml(text);
  } catch (e) {
    if (e instanceof XmlError) {
      throw new ScanError('XML_MALFORMED', { line: e.line, column: e.column, reason: e.reason, ...e.params });
    }
    throw e;
  }
  const name = root.localName.toLowerCase();
  if (name === 'project') return parseMsbuild(root);
  if (name === 'packages') return parsePackagesConfig(root);
  if (name === 'configuration') throw new ScanError('XML_CONFIG_FILE');
  throw new ScanError('XML_UNSUPPORTED_ROOT', { root: root.name });
}

function parseJsonManifest(text) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch (e) {
    throw new ScanError('JSON_MALFORMED', jsonErrorPosition(String(e?.message ?? ''), text) ?? {});
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new ScanError('JSON_UNSUPPORTED');
  if ('lockfileVersion' in obj) throw new ScanError('PACKAGE_LOCK_UNSUPPORTED');
  if (Array.isArray(obj.packages) || 'content-hash' in obj) return parseComposerLock(obj);
  if ('require' in obj || 'require-dev' in obj) return parseComposerJson(obj);
  if (['dependencies', 'devDependencies', 'optionalDependencies', 'engines'].some((k) => k in obj)) {
    return parsePackageJson(obj);
  }
  throw new ScanError('JSON_UNSUPPORTED');
}

/**
 * @param {string} input the pasted or uploaded file content
 * @returns {Manifest}
 * @throws {ScanError}
 */
export function parseManifest(input) {
  if (typeof input !== 'string' || !input.trim()) throw new ScanError('EMPTY_INPUT');
  if (input.length > MAX_INPUT_CHARS) throw new ScanError('INPUT_TOO_LARGE', { limitMb: 2 });
  // A byte-order mark is not whitespace to JSON.parse; strip it, keep every line intact.
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const head = text.trimStart();
  if (head.startsWith('<')) return parseXmlManifest(text);
  if (head.startsWith('{') || head.startsWith('[')) return parseJsonManifest(text);
  if (/^Microsoft Visual Studio Solution File/i.test(head)) throw new ScanError('SOLUTION_FILE');
  throw new ScanError('UNKNOWN_FORMAT');
}
