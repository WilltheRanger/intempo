/**
 * Nothing on the web: every browser this app runs in has a complete `URL`.
 *
 * `react-native-url-polyfill/auto` was imported unconditionally, so the web
 * build shipped 20 KB of a URL parser (measured from its source map,
 * 2026-10-05) only to install it over the browser's own.
 */
export {};
