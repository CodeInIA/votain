import { cn } from '../../lib/utils';

/**
 * A member, drawn from the only thing the chain knows about them.
 *
 * WHAT IT REPLACED, and why the replacement is not only cosmetic. The member
 * list used `Avatar`, which is the initials-of-a-person component: it takes a
 * `fallback` and cuts it to two characters. The list handed it four hex digits
 * of the commitment and two were thrown away in silence, so every member was
 * labelled with a pair like "1A" inside a circle.
 *
 * Two characters of hex is 256 possible labels. With around twenty distinct
 * voters it is already more likely than not that two members carry the same one,
 * and by forty it is close to certain: the badge stops telling them apart at
 * exactly the size where a list needs it to. This uses the WHOLE commitment, so
 * two members differ unless the commitments do.
 *
 * And a circle of initials is the visual grammar of a person, in the one list
 * that exists because there are no identifiable people in it. A pattern is not a
 * face. It is the same convention wallets use for an address, so it also reads
 * as "an identifier", which is what it is.
 *
 * Symmetric down the middle, like a Rorschach card or a GitHub identicon:
 * mirroring makes a small pattern far easier to recognise again than the same
 * number of random cells, which is the entire job here. Three columns of data
 * become five.
 */

const COLUMNS = 3;
const ROWS = 5;
const GRID = COLUMNS * 2 - 1;

/**
 * FNV-1a, over the whole value.
 *
 * Not a security hash and nothing here needs one: this only has to spread
 * similar inputs apart and give the same answer every time, on every device, for
 * a value that is already public on chain.
 */
function hash32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export interface FingerprintShape {
  hue: number;
  /** Row-major grid of `GRID` x `ROWS`, already mirrored. */
  cells: boolean[];
}

/**
 * The pattern itself, separated from how it is drawn so it can be tested for
 * what matters: the same commitment always produces the same shape.
 *
 * The hue comes from a second pass rather than from spare bits of the first.
 * Colour and pattern taken from one number move together, and two members who
 * happen to share low bits would come out looking related when they are not.
 */
export function fingerprintOf(value: string): FingerprintShape {
  const bits = hash32(value.toLowerCase());
  const hue = hash32(`${value.toLowerCase()}:hue`) % 360;

  const cells: boolean[] = Array.from({ length: GRID * ROWS }, () => false);
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLUMNS; col++) {
      const on = ((bits >>> (row * COLUMNS + col)) & 1) === 1;
      cells[row * GRID + col] = on;
      cells[row * GRID + (GRID - 1 - col)] = on; // the mirror
    }
  }
  return { hue, cells };
}

interface CommitmentFingerprintProps {
  /** The identity commitment, as `0x` hex. */
  value: string;
  className?: string;
}

export function CommitmentFingerprint({ value, className }: CommitmentFingerprintProps) {
  const { hue, cells } = fingerprintOf(value);

  // One hue per member, at a fixed saturation and lightness, so the whole list
  // stays in one family instead of turning into confetti on a dark surface.
  const ink = `hsl(${hue} 60% 66%)`;
  const ground = `hsl(${hue} 32% 16%)`;

  return (
    <div
      className={cn(
        // A rounded SQUARE, not a circle. A circle crops the four corner cells,
        // which is where a mirrored pattern carries much of what makes it
        // recognisable, and it is the shape this app uses for faces.
        'w-8 h-8 rounded-lg overflow-hidden shrink-0 border border-white/10',
        className,
      )}
      style={{ background: ground }}
      // Decorative: the commitment it stands for is written in full on the same
      // row, and "a blue and green pattern" is not a useful thing to read out.
      aria-hidden="true"
    >
      <svg viewBox={`0 0 ${GRID} ${ROWS}`} className="w-full h-full" preserveAspectRatio="none">
        {cells.map((on, i) =>
          on ? (
            <rect
              key={i}
              x={i % GRID}
              y={Math.floor(i / GRID)}
              width={1}
              height={1}
              fill={ink}
            />
          ) : null,
        )}
      </svg>
    </div>
  );
}
