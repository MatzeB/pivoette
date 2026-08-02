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
  Duration: 'duration',
  /** Locale weekday ordinal (0 = the locale's first day) -> name. */
  Weekday: 'weekday',
  /** 1..12 -> month name. */
  Month: 'month',
} as const;

export const Style = {
  SignColors: 'signColors',
  Conditional: 'conditional',
  Static: 'static',
} as const;

export const Render = {
  ImageText: 'imageText',
} as const;
