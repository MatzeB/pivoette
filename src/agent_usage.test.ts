/**
 * `agent_usage.md` is the spec we hand to other models, so a stale example
 * there is a bug that ships to every generated bundle. These tests parse the
 * doc's own code blocks and run the complete ones, which means the doc cannot
 * drift away from the loader without turning the suite red.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadBundle, validateBundle } from './bundle';
import type { PivoetteBundle } from './bundle';
import { computeView } from './pivot/engine';
import { aggregationIds } from './pivot/aggregations';
import { ColumnKind, SCALE_SHORT, UNIT_SHORT } from './data/meta';
import { temporalHelpers } from './data/temporal';

// Relative to the vitest root, which is the project root.
const doc = readFileSync(resolve('agent_usage.md'), 'utf8');

/** Fenced ```json blocks only; ```jsonc ones carry comments by design. */
function jsonBlocks(): string[] {
  return [...doc.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]!);
}

/** Every backticked name in the paragraph following the given heading. */
function listedAfter(heading: string): string[] {
  const at = doc.indexOf(heading);
  expect(at, `agent_usage.md no longer contains "${heading}"`).toBeGreaterThan(
    -1,
  );
  // From the end of the heading, so its own backticks are not collected, and
  // past any blank line, so a `### Heading` picks up the paragraph below it.
  const from =
    at +
    heading.length +
    /^\s*/.exec(doc.slice(at + heading.length))![0].length;
  const chunk = doc.slice(from, doc.indexOf('\n\n', from));
  return [...chunk.matchAll(/`([^`]+)`/g)].map((m) => m[1]!);
}

describe('agent_usage.md', () => {
  it('has JSON examples that all parse', () => {
    const blocks = jsonBlocks();
    expect(blocks.length).toBeGreaterThan(5);
    for (const block of blocks) {
      expect(() => JSON.parse(block)).not.toThrow();
    }
  });

  it('has complete examples that load, validate and compute', async () => {
    const complete = jsonBlocks()
      .map((b) => JSON.parse(b) as Partial<PivoetteBundle>)
      .filter((b) => b.data && b.view);
    // The minimal example and the complete one, at least.
    expect(complete.length).toBeGreaterThanOrEqual(2);

    for (const bundle of complete) {
      const frame = await loadBundle(bundle as PivoetteBundle);
      expect(validateBundle(bundle, frame).problems).toEqual([]);
      const result = computeView(frame, bundle.view!);
      expect(result.rows.length).toBeGreaterThan(0);
    }
  });

  it('documents the aggregations that actually exist', () => {
    const documented = listedAfter('### Aggregations (`agg`)');
    for (const id of aggregationIds()) {
      expect(documented, `agg "${id}" is missing from the doc`).toContain(id);
    }
  });

  it('documents temporal helpers that actually exist', () => {
    const documented = listedAfter('Temporal helpers available in `compute`:');
    const real = Object.keys(temporalHelpers());
    for (const name of documented) {
      expect(real, `doc names a helper that does not exist`).toContain(name);
    }
  });

  it('documents kinds, units and scales that actually exist', () => {
    for (const kind of listedAfter('`kind` values:')) {
      expect(
        Object.values(ColumnKind) as string[],
        `doc names kind "${kind}"`,
      ).toContain(kind);
    }
    for (const unit of listedAfter('Units with known short forms:')) {
      expect(UNIT_SHORT, `doc names unit "${unit}"`).toHaveProperty(unit);
    }
    for (const scale of listedAfter('Scales:')) {
      expect(SCALE_SHORT, `doc names scale "${scale}"`).toHaveProperty(scale);
    }
  });
});
