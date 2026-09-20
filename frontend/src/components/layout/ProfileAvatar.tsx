/**
 * The link to your own profile, drawn as you rather than as anybody.
 *
 * WHAT IT REPLACED. Both roles wore the same `User` silhouette and were told
 * apart by colour alone, which is the weakest signal there is: #4F8EF7 and
 * #00D4FF are a blue and a cyan that protanopia and deuteranopia bring much
 * closer together than they look. The voter's badge also carried a dot in the
 * bottom-right corner, the position and shape every interface uses for "online"
 * or "unread", meaning neither here and drawn for one role and not the other.
 * It was decoration shaped like a status.
 *
 * WHERE EACH PATTERN COMES FROM, which is the whole design:
 *
 *   organizer  their wallet address. Public by intent, the way every wallet
 *              draws an address, and the same thing their elections are signed
 *              with.
 *   voter      a seed derived from their recovery phrase under its own salt,
 *              which exists on no chain and no server. NOT their commitment:
 *              that is published in the merkle tree of every election they
 *              joined, so a badge drawn from it would let anyone who saw this
 *              screen match the pattern against the public registry and read
 *              off their enrolments. See `avatarSeed`.
 *
 * A rounded square, not a circle, because `CommitmentFingerprint` says so: a
 * circle crops the four corner cells, which is where a mirrored pattern carries
 * much of what makes it recognisable.
 *
 * FORTY-FOUR PIXELS OF TARGET around thirty-two of badge. On a phone this is the
 * only way to a voter's recovery phrase, their passkeys and the way out, and the
 * tab bar has no profile entry: the target was 32px against the 44 iOS asks for
 * and the 48 Android does. The padding is transparent, so nothing looks bigger.
 */
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { ProfileGlyph } from '../ui/ProfileGlyph';
import { cn } from '../../lib/utils';
import { getRememberedOrganizerAddress } from '../../hooks/useOrganizerWallet';
import { avatarSeed } from '../../lib/semaphore';

export function ProfileAvatar({ role }: { role: 'voter' | 'organizer' }) {
  const { t } = useTranslation();

  /**
   * Read at render, not held in state.
   *
   * Both values are written by something outside React (a wallet connecting, an
   * identity resolving), and a snapshot taken once at mount would show the
   * fallback for the rest of the session on the very visit that created them.
   */
  const seed =
    role === 'organizer' ? getRememberedOrganizerAddress() ?? null : avatarSeed();

  return (
    /* A LINK, NOT A BUTTON, and the difference is everything a browser does
       for free with a URL: open in a new tab from the context menu, the middle
       button or ctrl, copy the address, see where it goes in the status bar,
       and be announced as a link rather than as a control that might do
       anything. `navigate` in an onClick throws all of that away to reimplement
       the one case it handles. */
    <Link
      to={`/${role}/profile`}
      aria-label={t('nav.profile')}
      // A native tooltip, which a pattern needs more than a glyph did: the badge
      // stopped being a labelled shape and became a picture of nobody in
      // particular, and on a desktop there is a pointer to answer.
      title={t('nav.profile')}
      /* THE TARGET IS 44, THE FEEDBACK IS 32. Hover used to paint a flat grey
         disc across the whole target: bigger than the mark it sat behind, the
         wrong colour for either role, and arriving as a blob rather than as a
         response. What answers now is the mark itself, in the colour that role
         already wears, so the thing the eye is on is the thing that reacts.
         `group` is what carries it: the padding stays a target and paints
         nothing. */
      className="group w-11 h-11 rounded-full flex items-center justify-center shrink-0 cursor-pointer"
    >
      <ProfileGlyph
        role={role}
        seed={seed}
        className={cn(
          // NO TRANSITION. A pointer arriving is not an animation worth playing:
          // 200ms of easing on a ring that only says "this is what you are on"
          // read as lag, because the answer trailed the cursor.
          'w-8 h-8',
          // A ring follows whatever radius it is given, so this fits the round
          // badge and the rounded square of a pattern without knowing which.
          'group-hover:ring-2 group-hover:ring-offset-2 ring-offset-background',
          role === 'voter' ? 'group-hover:ring-tertiary/50' : 'group-hover:ring-primary/50',
          'group-focus-visible:ring-2 group-focus-visible:ring-offset-2',
          role === 'voter' ? 'group-focus-visible:ring-tertiary' : 'group-focus-visible:ring-primary',
        )}
      />
    </Link>
  );
}
