/**
 * The button that leads to your own profile, drawn as you rather than as
 * anybody.
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
 * FORTY-FOUR PIXELS OF BUTTON around thirty-two of badge. On a phone this is the
 * only way to a voter's recovery phrase, their passkeys and the way out, and the
 * tab bar has no profile entry: the target was 32px against the 44 iOS asks for
 * and the 48 Android does. The padding is transparent, so nothing looks bigger.
 */
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { ProfileGlyph } from '../ui/ProfileGlyph';
import { getRememberedOrganizerAddress } from '../../hooks/useOrganizerWallet';
import { avatarSeed } from '../../lib/semaphore';

export function ProfileAvatar({ role }: { role: 'voter' | 'organizer' }) {
  const { t } = useTranslation();
  const navigate = useNavigate();

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
    <button
      type="button"
      data-nav-href={`/${role}/profile`}
      onClick={() => navigate(`/${role}/profile`)}
      aria-label={t('nav.profile')}
      // A native tooltip, which a pattern needs more than a glyph did: the badge
      // stopped being a labelled shape and became a picture of nobody in
      // particular, and on a desktop there is a pointer to answer.
      title={t('nav.profile')}
      /* NO negative margin, though the badge inside is 32 and the box is 44.
         Pulling the difference back out of the margin hung the button six
         pixels past the bar's own padding, which cost nothing while the box was
         invisible and costs the moment it is painted: the hover disc would
         bleed over the edge of the bar. So the disc sits six pixels inside the
         margin and the thing that lights up is what lines up, which is how a
         nav button is supposed to behave. */
      className="w-11 h-11 rounded-full flex items-center justify-center shrink-0 cursor-pointer transition-colors hover:bg-on-surface/10"
    >
      <ProfileGlyph role={role} seed={seed} className="w-8 h-8" />
    </button>
  );
}
