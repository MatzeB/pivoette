/**
 * Shared test helper: normalize a standalone metadata input so assertions can
 * be written against labels and deduction without building a whole frame.
 */
import { normalizeMeta } from './data/meta';
import type { ColumnMeta, ColumnMetaInput } from './data/meta';

export function testMeta(input: ColumnMetaInput): ColumnMeta {
  return normalizeMeta(
    { dataName: 'x', type: 'float', category: 'data' },
    input,
  );
}
