/**
 * The custom elements as JSX tags. React 19 assigns a prop as a property when
 * the element has one (`theme`, `open`) and as an attribute otherwise (`for`,
 * `height`), so these are typed as what the elements accept either way.
 */
import type { DetailedHTMLProps, HTMLAttributes } from 'react';
import type {
  PivoetteEditorElement,
  PivoetteTableElement,
} from '../src/element';

type Theme = 'auto' | 'light' | 'dark';

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'pivoette-table': DetailedHTMLProps<
        HTMLAttributes<PivoetteTableElement>,
        PivoetteTableElement
      > & { src?: string; height?: number | string; theme?: Theme };
      'pivoette-editor': DetailedHTMLProps<
        HTMLAttributes<PivoetteEditorElement>,
        PivoetteEditorElement
      > & { for?: string; theme?: Theme; open?: boolean; 'no-reset'?: '' };
    }
  }
}
