import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { SearchCheck, RefreshCw, Languages, ShieldAlert } from 'lucide-react';
import { AvatarCard } from '../../components/ui/AvatarCard';
import { ProfileGlyph } from '../../components/ui/ProfileGlyph';
import { roleAccent } from '../../lib/activeRole';
import { cn } from '../../lib/utils';
import { avatarSeed } from '../../lib/semaphore';
import { PageLayout } from '../../components/layout/PageLayout';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { LanguageSelector } from '../../components/ui/LanguageSelector';
import { MyPasskeys } from '../../components/voter/MyPasskeys';
import { VerifiedVoterCard } from '../../components/voter/VerifiedVoterCard';
import { RecoveryPhraseCard } from '../../components/voter/RecoveryPhraseCard';
import { OtherRoleCard } from '../../components/ui/OtherRoleCard';
import { SignOutActions } from '../../components/ui/SignOutActions';
import { SiteLinksCard } from '../../components/layout/SiteLinksCard';

export default function VoterProfile() {
  const navigate = useNavigate();
  const { t } = useTranslation();

  return (
    <PageLayout role="voter" showNav>
      <div className="max-w-xl mx-auto pt-6 pb-24">
        <h1 className="text-2xl font-black tracking-tight text-white mb-6 flex items-start gap-2">
          {/* Follows the same switch as the badge in the top bar: turning it
              on must not change one mark and leave this one saying something
              else about the same person. */}
          <ProfileGlyph role="voter" chrome="bare" seed={avatarSeed()} className="w-5 h-5 shrink-0 mt-1.5" />
          {t('profile.title')}
        </h1>

        {/* Who this voter is to the platform, and what that number means. */}
        <VerifiedVoterCard />

        {/* Second, against the card above: the switch belongs within sight of
            the drawing it turns into an icon, not five cards below where the
            two never share a screen. */}
        <AvatarCard seed={avatarSeed()} role="voter" />

        {/* Quick links */}
        <Card className="p-5 mb-4">
          <div className="flex flex-col gap-2">
            {/* Dressed as the card headings around it, because that is what it
                reads as: the one line this card has. `-mx-3` gives back the
                padding the button needs for its hover box, so the icon starts
                on the same vertical as every other title on the page instead of
                twelve pixels inside it. */}
            <Button
              variant="ghost"
              className="justify-start gap-2 px-3 py-3 -mx-3 h-auto rounded-xl hover:bg-white/5 text-sm font-semibold text-on-surface"
              onClick={() => navigate('/verify-receipt')}
            >
              <SearchCheck className={cn('w-4 h-4 shrink-0', roleAccent('voter'))} />
              {t('verify_receipt.title')}
            </Button>
          </div>
        </Card>

        {/* The root of the identity, and the only part of it that survives
            losing every device. First because it is the answer to the question
            the rest of this page raises. */}
        <RecoveryPhraseCard />

        {/* Passkeys that can unlock this voter's identity */}
        <MyPasskeys />

        {/* The voter's own copy of that identity, for the case where neither
            this server nor the chain is reachable. */}

        {/* The other half of what this person may be. Both sessions can be
            held at once and the header switches between them, so the profile
            is where that gets said. */}
        <OtherRoleCard role="organizer" />

        {/* Language */}
        <Card className="p-5 mb-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-on-surface flex items-center gap-2">
              <Languages className={cn('w-4 h-4 shrink-0', roleAccent('voter'))} />
              {t('landing.footer.language')}
            </p>
            <LanguageSelector align="right" />
          </div>
        </Card>

        {/* The footer's links, for the screens where the footer is hidden.
            Minus the verifier: the quick actions above link it at every width,
            and two ways to one page on one screen is not two features. */}
        <SiteLinksCard omit={['/verify-receipt']} />

        {/* Down here with the sign-out, and no longer a row in the quick links
            above. It was styled exactly like "verify a vote": one ghost button
            among peers, for an action that revokes the identity and closes every
            election this person had already joined. It also called itself a
            recovery to somebody whose identity works, which describes nothing
            they are experiencing.
            Kept rather than removed, because there IS a reason to reach it from
            here and it is not being locked out: a device lost or stolen. Removing
            a passkey changes which copies the chain serves and erases nothing
            from its history, so rotating is the real answer, and the passkey
            removal dialog points at this same route. */}
        <Card className="p-5 mb-4">
          <p className="text-sm font-semibold text-on-surface flex items-center gap-2">
            {/* Not the button's `RefreshCw`: one marks the section, the other is
                the action, and the same glyph twice in one card reads as a slip. */}
            <ShieldAlert className={cn('w-4 h-4 shrink-0', roleAccent('voter'))} />
            {t('reverify.title')}
          </p>
          <p className="text-xs text-on-surface-meta leading-relaxed mt-1">
            {t('profile.reverify_hint')}
          </p>
          <Button
            variant="ghost"
            /* ONE hover background. It carried both `bg-white/5` and
               `bg-warning/10`, and the one that won was whichever Tailwind
               emitted last: #facc15 at a tenth over a dark navy card, which is
               the olive smear this looked like. The warning belongs in the text
               and the icon, which already carry it; the surface behind them
               lifts the same neutral amount as every other row here. */
            className="justify-start gap-3 px-3 py-3 h-auto mt-2 rounded-xl text-sm text-warning hover:bg-white/5 hover:text-warning"
            onClick={() => navigate('/voter/re-verify')}
          >
            <RefreshCw className="w-4 h-4 shrink-0" />
            {t('reverify.verify_btn')}
          </Button>
        </Card>

        {/* Sign out, of this role or of both when both are held. */}
        <SignOutActions role="voter" />
      </div>
    </PageLayout>
  );
}
