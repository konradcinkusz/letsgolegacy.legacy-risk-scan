// What the scanner knows about specific libraries, kept in one table so it can be read
// (and argued with) in one place.
//
// 1. JavaScript libraries shipped through NuGet. Old ASP.NET projects get jQuery,
//    Bootstrap, Modernizr… as NuGet packages, but the advisory databases file most of
//    their vulnerabilities under npm, the library's home registry. The code is the same,
//    so such packages are checked under both names.
// 2. Script files with a version in their name (Scripts\jquery-1.10.2.js). A classic
//    .csproj lists them as <Content>; it is often the only trace of the library.
// 3. Packages whose version maps to a product on endoflife.date (jQuery → "jquery",
//    laravel/framework → "laravel", …).

/** NuGet id (lower-case) → npm package name. */
export const NUGET_TO_NPM = new Map([
  ['jquery', 'jquery'],
  ['jquery.ui.combined', 'jquery-ui'],
  ['jquery.ui', 'jquery-ui'],
  ['jquery.validation', 'jquery-validation'],
  ['microsoft.jquery.unobtrusive.validation', 'jquery-validation-unobtrusive'],
  ['microsoft.jquery.unobtrusive.ajax', 'jquery-ajax-unobtrusive'],
  ['bootstrap', 'bootstrap'],
  ['modernizr', 'modernizr'],
  ['knockoutjs', 'knockout'],
  ['angularjs', 'angular'],
  ['angularjs.core', 'angular'],
  ['moment.js', 'moment'],
  ['momentjs', 'moment'],
  ['lodash', 'lodash'],
  ['underscore.js', 'underscore'],
  ['handlebars.js', 'handlebars'],
]);

/**
 * Script file name → npm package. Matches "jquery-1.10.2.js", "jquery-1.10.2.min.js",
 * "jquery-ui-1.8.24.js", "modernizr-2.6.2.js", "knockout-3.4.2.debug.js", …
 * Order matters: the longer, more specific names come first.
 */
const SCRIPT_PATTERNS = [
  ['jquery-ui', 'jquery-ui'],
  ['jquery-migrate', 'jquery-migrate'],
  ['jquery.validate.unobtrusive', 'jquery-validation-unobtrusive'],
  ['jquery.validate', 'jquery-validation'],
  ['jquery.signalr', 'signalr'],
  ['jquery', 'jquery'],
  ['modernizr', 'modernizr'],
  ['knockout', 'knockout'],
  ['angular', 'angular'],
  ['bootstrap', 'bootstrap'],
  ['moment', 'moment'],
  ['lodash', 'lodash'],
  ['handlebars', 'handlebars'],
];

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const SCRIPT_RE = new RegExp(
  `(?:^|[\\\\/])(${SCRIPT_PATTERNS.map(([n]) => escape(n)).join('|')})[-.](\\d+\\.\\d+(?:\\.\\d+)?)` +
    '(?:[.-](?:min|slim|slim\\.min|debug|intellisense|vsdoc))?\\.js$',
  'i',
);

/**
 * Recognises a versioned script file.
 * @param {string} path e.g. "Scripts\\jquery-1.10.2.min.js"
 * @returns {{ npmName: string, version: string } | null}
 */
export function matchScriptFile(path) {
  const m = SCRIPT_RE.exec(String(path ?? ''));
  if (!m) return null;
  const entry = SCRIPT_PATTERNS.find(([n]) => n === m[1].toLowerCase());
  return entry ? { npmName: entry[1], version: m[2] } : null;
}

/**
 * Package → endoflife.date product, where the package's own version identifies the
 * release cycle. Keys are "<ecosystem>:<lower-case name>".
 */
const PACKAGE_PRODUCTS = new Map([
  ['npm:jquery', 'jquery'],
  ['NuGet:jquery', 'jquery'],
  ['npm:bootstrap', 'bootstrap'],
  ['NuGet:bootstrap', 'bootstrap'],
  ['npm:angular', 'angularjs'],
  ['NuGet:angularjs', 'angularjs'],
  ['NuGet:angularjs.core', 'angularjs'],
  ['npm:@angular/core', 'angular'],
  ['Packagist:laravel/framework', 'laravel'],
  ['Packagist:symfony/symfony', 'symfony'],
  ['Packagist:symfony/framework-bundle', 'symfony'],
  ['Packagist:symfony/http-kernel', 'symfony'],
]);

/** @returns {string|null} endoflife.date product id */
export function productForPackage(ecosystem, name) {
  return PACKAGE_PRODUCTS.get(`${ecosystem}:${String(name).toLowerCase()}`) ?? null;
}

/** @returns {string|null} npm name to check in addition to the NuGet id */
export function npmAliasForNuGet(name) {
  return NUGET_TO_NPM.get(String(name).toLowerCase()) ?? null;
}
