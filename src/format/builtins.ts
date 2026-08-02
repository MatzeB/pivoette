/**
 * Names of the built-in format / style / render functions, as constants.
 *
 * Hints for discoverability only: each spec's `name` stays a plain string, so
 * anything passed to `registerFormat` / `registerStyle` / `registerRender`
 * works just as well. Kept in one module rather than beside each registry so
 * they can be imported without pulling in the renderers' JSX.
 *
 * `builtins.test.ts` checks every value here actually resolves, so the lists
 * cannot drift from the registries.
 */

export const Format = {
  Number: 'number',
  Integer: 'integer',
  /**
   * `Intl`'s percent style: **multiplies by 100** and appends its own `%`, for
   * data stored as a ratio (`0.0523` -> `5.2%`).
   *
   * Not interchangeable with `scale: ['percent']`, which only appends a label
   * and never touches the number — that is for data already in percentage
   * points (`5.23` -> `5.23%`). Combining the two double-appends (`5.2%%`), so
   * pick whichever matches how the column is stored: the format when it holds
   * ratios, the scale when it holds points.
   */
  Percent: 'percent',
  Duration: 'duration',
} as const;

export const Style = {
  SignColors: 'signColors',
  Conditional: 'conditional',
  Static: 'static',
} as const;

export const Render = {
  ImageText: 'imageText',
} as const;
