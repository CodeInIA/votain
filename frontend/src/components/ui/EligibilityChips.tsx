/**
 * An election's entry requirements, shown on cards and list rows.
 *
 * DELIBERATELY NOT A `Badge`. Every Badge variant is the same shape: an
 * uppercase translucent pill with a ring, which is the vocabulary of election
 * PHASE. A restriction is a different kind of fact, and rendering it in the
 * phase vocabulary made it read as another status and disappear next to one.
 * These are mixed case, softer cornered and carry an icon, so the difference is
 * legible without either one shouting over the other.
 *
 * They show the actual rules rather than the word "Restricted". Someone
 * scanning a list wants to know whether they qualify, and "18+" next to a
 * Spanish flag answers that where a generic label only raises the question.
 *
 * Renders nothing for an unrestricted election, so callers can drop it in
 * without guarding first.
 */
import { CalendarCheck, Globe, Ban, IdCard, ScanFace } from 'lucide-react';
import { cn } from '../../lib/utils';
import { usePolicyChips, type PolicyChipKind } from '../../hooks/usePolicyChips';
import type { EligibilityPolicy } from '../../lib/eligibility';

/**
 * Colour lives in the ICON, never in the fill.
 *
 * A solid amber block competed with the phase pill beside it, which is already
 * yellow while an election is enrolling, and read as a warning rather than as a
 * fact about the election. These sit on the same neutral surface as the rest of
 * a card's metadata and let the icon and the flag carry the meaning, which is
 * quieter and, next to a loud status pill, actually easier to pick out.
 */
const ICON_COLORS: Record<PolicyChipKind, string> = {
  document: 'text-primary',
  orb:      'text-primary',
  age:     'text-primary',
  allowed: 'text-primary',
  // The one rule that excludes rather than admits, so the one that earns a
  // colour of its own. On the icon only: a red chip read as an error state.
  blocked: 'text-error',
};

const CHIP_ICONS: Record<PolicyChipKind, typeof Globe> = {
  // A document scan and an Orb are different enough acts to deserve different
  // pictures: one is held in the hand, the other looked into.
  document: IdCard,
  orb: ScanFace,
  age: CalendarCheck,
  allowed: Globe,
  blocked: Ban,
};

interface Props {
  policy: EligibilityPolicy | null | undefined;
  className?: string;
}

export function EligibilityChips({ policy, className }: Props) {
  const chips = usePolicyChips(policy);
  if (chips.length === 0) return null;

  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
      {chips.map(chip => {
        const Icon = CHIP_ICONS[chip.kind];
        return (
          <span
            key={chip.kind}
            title={chip.title}
            className={cn(
              'inline-flex items-center gap-1.5 px-2 py-1 rounded-lg',
              'bg-surface-high/70 ring-1 ring-outline-variant/25',
              // Mixed case and no tracking, unlike the uppercase phase pills:
              // the difference in typography does as much of the work as the
              // shape does.
              'text-xs font-semibold leading-none whitespace-nowrap text-on-surface',
            )}
          >
            <Icon className={cn('w-3.5 h-3.5 shrink-0', ICON_COLORS[chip.kind])} strokeWidth={2.5} />
            {chip.label}
          </span>
        );
      })}
    </div>
  );
}
