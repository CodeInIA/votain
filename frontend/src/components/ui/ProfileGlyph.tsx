/**
 * The mark that stands for you: a glyph, or your pattern if you asked for one.
 *
 * One component for both places it appears, the button in the top bar and the
 * icon beside the profile heading, so flipping the switch cannot change one and
 * leave the other saying something else. That was the bug this whole thread
 * started from, in a different guise: two marks for one person, disagreeing.
 *
 * The role decides the colour of the fallback, and `roleAccent` decides what the
 * role's colour is. See `lib/activeRole`.
 */
import { User } from 'lucide-react';

import { CommitmentFingerprint } from './CommitmentFingerprint';
import { roleAccent, type Role } from '../../lib/activeRole';
import { useAvatarAsProfileIcon } from '../../lib/avatarPreference';
import { cn } from '../../lib/utils';

export function ProfileGlyph({
  role,
  seed,
  chrome = 'badge',
  className,
}: {
  role: Exclude<Role, 'public'>;
  /** Null until there is something to draw from: an identity still locked. */
  seed: string | null;
  /**
   * What the fallback wears.
   *
   * `badge` is the ringed disc the top bar has always had. `bare` is the plain
   * icon a page heading wants, and putting the ring there was a regression: the
   * other eight headings carry an unadorned glyph, and at the 20px a heading
   * uses, a ring around an icon half that size is clutter rather than a shape.
   */
  chrome?: 'badge' | 'bare';
  className?: string;
}) {
  const wanted = useAvatarAsProfileIcon();

  if (wanted && seed) {
    return <CommitmentFingerprint value={seed} className={className} />;
  }

  if (chrome === 'bare') {
    return <User className={cn(roleAccent(role), className)} />;
  }

  return (
    <span
      className={cn(
        'rounded-full flex items-center justify-center border',
        role === 'voter' ? 'bg-tertiary/10 border-tertiary/20' : 'bg-primary/10 border-primary/20',
        className,
      )}
    >
      {/* Half the box, which is what the old badge did and what keeps a glyph
          from touching the ring it sits in. */}
      <User className={cn('w-1/2 h-1/2', roleAccent(role))} />
    </span>
  );
}
