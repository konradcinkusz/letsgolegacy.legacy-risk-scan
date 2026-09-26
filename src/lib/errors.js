// The one error type the scan reports to a visitor. It carries a code and parameters,
// never display text: the Polish wording lives in messages.js, so parsers stay testable
// on codes and the copy can change without touching them.

export class ScanError extends Error {
  /**
   * @param {string} code see ERROR_MESSAGES in messages.js
   * @param {Record<string, unknown>} [params]
   */
  constructor(code, params = {}) {
    super(code);
    this.name = 'ScanError';
    this.code = code;
    this.params = params;
  }
}
