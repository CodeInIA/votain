/**
 * What the mark looks like in each of the two places it appears.
 *
 * Written because the voter half cannot be reached in a browser without a
 * backend and a World ID scan, so the accent and the seed were the one thing a
 * screenshot could not check. It also pins the regression that started this:
 * the ringed badge followed the glyph into the page headings, where the other
 * eight titles carry a bare icon.
 */
import { render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ProfileGlyph } from './ProfileGlyph';
import { setAvatarAsProfileIcon } from '../../lib/avatarPreference';

afterEach(() => {
  setAvatarAsProfileIcon(false);
  localStorage.clear();
});

/** The ring is a span; the glyph is the svg inside it, or on its own. */
const dibujo = (c: HTMLElement) => ({
  anillo: c.querySelector('span.rounded-full'),
  glifo: c.querySelector('svg.lucide-user'),
  patron: c.querySelector('svg:not(.lucide-user)'),
});

describe('the mark that stands for you', () => {
  it('wears the ring in the top bar and nothing in a heading', () => {
    const barra = dibujo(render(<ProfileGlyph role="voter" seed={null} />).container);
    expect(barra.anillo).not.toBeNull();

    const titulo = dibujo(render(<ProfileGlyph role="voter" seed={null} chrome="bare" />).container);
    expect(titulo.anillo).toBeNull();
    expect(titulo.glifo).not.toBeNull();
  });

  it('takes its colour from the role, in either dress', () => {
    for (const chrome of ['badge', 'bare'] as const) {
      const votante = dibujo(render(<ProfileGlyph role="voter" seed={null} chrome={chrome} />).container);
      expect(votante.glifo?.getAttribute('class')).toContain('text-tertiary');

      const organizador = dibujo(render(<ProfileGlyph role="organizer" seed={null} chrome={chrome} />).container);
      expect(organizador.glifo?.getAttribute('class')).toContain('text-primary');
    }
  });

  it('shows the glyph until the pattern is asked for, and then only if there is one', () => {
    // Off by default, which is the whole point of the switch.
    expect(dibujo(render(<ProfileGlyph role="voter" seed="a1b2c3" />).container).glifo).not.toBeNull();

    setAvatarAsProfileIcon(true);
    const conPatron = dibujo(render(<ProfileGlyph role="voter" seed="a1b2c3" />).container);
    expect(conPatron.glifo).toBeNull();
    expect(conPatron.patron).not.toBeNull();

    // Asked for, but the identity is still locked on this device: back to the glyph.
    expect(dibujo(render(<ProfileGlyph role="voter" seed={null} />).container).glifo).not.toBeNull();
  });
});
