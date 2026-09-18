/**
 * Your pattern, shown where it can be explained, and off until you ask for it.
 *
 * WHY IT IS NOT THE DEFAULT. A profile button that draws a pattern is not
 * obviously a profile button: the glyph says "you" to somebody who has never
 * seen this app, and the pattern only says it once you know what it is. So the
 * top bar keeps the glyph and this is where the pattern is introduced, next to
 * a sentence about where it comes from, with a switch for anybody who prefers
 * it up there.
 *
 * WHERE EACH ONE COMES FROM, which is the part worth reading:
 *
 *   organizer  their wallet address. Public by intent, and drawn the way every
 *              wallet draws an address.
 *   voter      twenty-four bits derived from their recovery phrase under its
 *              own salt. NOT their commitment: that one is published in the
 *              merkle tree of every election they joined, so a badge drawn from
 *              it would let anyone who saw the screen match the pattern against
 *              the public registry and read off their enrolments.
 *
 * Twenty-four bits is not a rounding: it is what the drawing itself shows, a
 * hue and fifteen mirrored cells. Storing the whole hash would have kept a value
 * that pins the phrase exactly, while `deviceSeal` was encrypting the phrase
 * three keys away. At this length a brute-force match still leaves around 2^60
 * candidate phrases, so the stored token is no more telling than the picture,
 * and the picture is already on screen.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Shapes } from 'lucide-react';

import { Card } from './Card';
import { Switch } from './Switch';
import { avatarAsProfileIcon, setAvatarAsProfileIcon } from '../../lib/avatarPreference';
import { roleAccent } from '../../lib/activeRole';
import { cn } from '../../lib/utils';

export function AvatarCard({ seed, role }: { seed: string | null; role: 'voter' | 'organizer' }) {
  const { t } = useTranslation();
  const [on, setOn] = useState(avatarAsProfileIcon);

  const toggle = (next: boolean) => {
    setAvatarAsProfileIcon(next);
    setOn(next);
  };

  return (
    <Card className="p-5 mb-4">
      <p className="text-sm font-semibold text-on-surface flex items-center gap-2">
        <Shapes className={cn('w-4 h-4 shrink-0', roleAccent(role))} />
        {t('profile.avatar_title')}
      </p>
      <p className="text-xs text-on-surface-meta mt-1 leading-relaxed">
        {t('profile.avatar_desc')}
      </p>

      {seed ? (
        /* The switch, and nothing else. The drawing itself is the first thing in
           the profile now, beside the identifier it comes from; a second copy of
           it three cards down read as a mistake rather than as a design, which
           is what it looked like on a phone where both fit on one screen. */
        <div className="mt-4">
          <Switch checked={on} onChange={toggle} label={t('profile.avatar_toggle')} />
        </div>
      ) : (
        /* A voter whose identity has not been unlocked here yet. There is
           nothing to draw and nothing to switch on, and saying why beats an
           empty square with a dead control beside it. */
        <p className="text-xs text-on-surface-meta mt-4">{t('profile.avatar_none')}</p>
      )}
    </Card>
  );
}
