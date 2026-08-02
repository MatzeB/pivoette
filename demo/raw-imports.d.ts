/**
 * Vite's `?raw` suffix imports a file's text. The demo uses it to show each
 * example's own source, comments and all, rather than a re-serialization of the
 * parsed object.
 */
declare module '*?raw' {
  const content: string;
  export default content;
}
