// "Not on the record" for a person's address (milestone M04): src/proxy.ts rewrites a missing,
// malformed or hidden person's address to NOT_ON_RECORD_PATH, an address no route uses, and sets
// NOT_ON_RECORD_HEADER on the request, so src/app/not-found.tsx answers 404 in a person's terms.
// A module of its own, so the proxy bundle does not pull in the page's components.

export const NOT_ON_RECORD_PATH = '/not-on-record';
export const NOT_ON_RECORD_HEADER = 'x-wcr-not-on-record';
