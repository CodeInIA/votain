import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Wallet, Languages, Eye, Pencil } from 'lucide-react';
import { PageLayout } from '../../components/layout/PageLayout';
import { Card } from '../../components/ui/Card';
import { OtherRoleCard } from '../../components/ui/OtherRoleCard';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { SignOutActions } from '../../components/ui/SignOutActions';
import { SiteLinksCard } from '../../components/layout/SiteLinksCard';
import { LanguageSelector } from '../../components/ui/LanguageSelector';
import { useOrganizerWallet } from '../../hooks/useOrganizerWallet';
import { MyDomains } from '../../components/organizer/MyDomains';
import { getOrganizerName, setOrganizerName } from '../../lib/organizer';
import { ProfileGlyph } from '../../components/ui/ProfileGlyph';
import { AvatarCard } from '../../components/ui/AvatarCard';
import { CommitmentFingerprint } from '../../components/ui/CommitmentFingerprint';
import { roleAccent } from '../../lib/activeRole';
import { cn } from '../../lib/utils';
import { getRememberedOrganizerAddress } from '../../hooks/useOrganizerWallet';

export default function OrganizerProfile() {
  const { t } = useTranslation();
  /** Read at render: the wallet may connect after this screen mounts. */
  const patron = getRememberedOrganizerAddress() ?? null;
  const wallet = useOrganizerWallet();

  const [displayName, setDisplayName] = useState(getOrganizerName);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(displayName);

  const saveName = () => {
    const next = nameInput.trim() || displayName;
    setOrganizerName(next);
    setDisplayName(next);
    setEditingName(false);
  };

  return (
    <PageLayout role="organizer" showNav>
      <div className="max-w-xl mx-auto pt-6 pb-24">
        {/* No back arrow. Every other page carrying one is somewhere you drill
            INTO from a list: an election, its results, the create wizard. This
            is reached from the avatar in the header, exactly like the voter
            profile beside it, which never had one. */}
        <h1 className="text-2xl font-black tracking-tight text-white mb-6 flex items-start gap-2">
          {/* See the voter's profile: one switch, both marks. */}
          <ProfileGlyph
            role="organizer"
            chrome="bare"
            seed={patron}
            className="w-5 h-5 shrink-0 mt-1.5"
          />
          {t('profile.title')}
        </h1>

        {/* Display name, and the pattern beside it.

            A profile opens with a picture of you, and the organizer's is drawn
            from the wallet, so it belongs next to the name that wallet signs
            under rather than three cards below by its own switch. It ignores the
            icon preference on purpose: that switch decides what the top bar
            wears, and this is the profile showing you yourself. */}
        <Card className="p-5 mb-4">
          {/* `items-start`, and the two lines beside it add up to exactly its
              height, so the drawing's top meets the heading and its foot meets
              the name. A tighter gap on a phone, which buys the name 4 pixels
              it needs at 390. */}
          <div className="flex items-start gap-3 sm:gap-4">
            {/* 56 AT EVERY WIDTH, and it is the text that is built to match: 20
                of heading plus the 36 of the row below is 56.

                It cannot be derived in CSS. `self-stretch` with `aspect-square`
                feeds back on itself here, because the square's width narrows the
                text column, the text grows taller and the square follows: it
                settled at 302 pixels. So if this number moves, the `h-9` below
                moves with it. */}
            {patron && <CommitmentFingerprint value={patron} className="w-14 h-14 shrink-0" />}
            <div className="flex-1 min-w-0">
              {/* The glyph goes AFTER the words, like the voter's shield, so the
                  two lines of this card share one left margin instead of the
                  heading starting 24 pixels right of the name below it.

                  An EYE, not a check. A tick beside a name reads as "verified",
                  and in this app that means something precise and different: the
                  card below verifies DOMAINS, by DNS record, and the display name
                  is free text nobody has checked. The eye claims only what is
                  true, which is what the label already says: this is the name
                  voters will see.

                  NO BOTTOM MARGIN. The name shares a row with `Editar`, which is
                  36 tall and lays 12 pixels of air under the heading by itself:
                  20 + 36 is exactly the 56 of the drawing. It was `mb-4`, which
                  made the column 72 and left the square jutting 8 above the
                  heading and 8 below the name. */}
              <h2 className="text-sm font-semibold text-on-surface flex items-center gap-2">
                {t('profile.display_name')}
                <Eye className={cn('w-4 h-4 shrink-0', roleAccent('organizer'))} />
              </h2>
              {/* ONLY THE EDITING ROW STACKS. The drawing beside it takes 56
                  and the gap 12, leaving a field and two buttons around 250 to
                  share on a phone, which is not enough for one line. The row that
                  merely shows the name keeps its shape at every width, since
                  stacking it would drop `Editar` below the drawing's foot and
                  cost the card the symmetry it is built around. */}
              {editingName ? (
                <div className="flex flex-col gap-3 sm:flex-row">
                  <div className="flex-1">
                    <Input
                      value={nameInput}
                      onChange={e => setNameInput(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && saveName()}
                      autoFocus
                    />
                  </div>
                  <div className="flex gap-3">
                    <Button variant="gradient" className="rounded-2xl px-4 h-11" onClick={saveName}>
                      {t('common.save')}
                    </Button>
                    <Button variant="ghost" className="rounded-2xl px-4 h-11" onClick={() => { setEditingName(false); setNameInput(displayName); }}>
                      {t('common.cancel')}
                    </Button>
                  </div>
                </div>
              ) : (
/* `items-end`, not `items-center`. This row is as tall as the
                   `Editar` button, and centring the name in it left the text
                   floating six pixels above the foot of the drawing beside it.
                   Sitting it on the row's floor puts the two bottom edges on the
                   same line, which is the whole point of the pairing.

One row at every width, so the card keeps the shape it has on a
                   desktop, and `h-9` holds that row at 36 whatever is in it: 20 of
                   heading plus 36 is the 56 of the drawing, and without the fixed
                   height a shorter button would collapse the row and break the
                   alignment from below.

                   `truncate` stays as the last resort for a name longer than this
                   one, because a second line would push its own foot past the
                   drawing's. It should not fire here, which is what the button
                   below is for. */
                <div className="flex items-end justify-between gap-2 sm:gap-3 h-9">
                  <p className="text-on-surface font-medium min-w-0 truncate">{displayName}</p>
                  {/* A PENCIL ON A PHONE, the word from `sm`, so a narrow screen
                      spends its width on the name rather than on the label of the
                      button beside it.

                      TWENTY-FOUR TALL IN THE LAYOUT, at both widths, which is the
                      height of the name it sits next to: with `items-end` that
                      puts the glyph and the text on one line. Filling the row's 36
                      instead centred the pencil six pixels high, which is what
                      looked crooked.

                      `w-11 h-11 -m-2.5` is how it stays pressable while
                      occupying 24: the box is the 44 square `conventions.md`
                      asks for, and the negative margin hides the ten around it,
                      so the target is full size and the alignment is unaffected.
                      It overflows into the card's own padding, which has 20 to
                      spare. */}
                  <Button
                    variant="ghost"
                    aria-label={t('common.edit')}
                    className="shrink-0 rounded-xl text-sm w-11 h-11 -m-2.5 p-0 sm:w-auto sm:h-6 sm:m-0 sm:px-3"
                    onClick={() => { setEditingName(true); setNameInput(displayName); }}
                  >
                    <Pencil className="w-4 h-4 sm:hidden" />
                    <span className="hidden sm:inline">{t('common.edit')}</span>
                  </Button>
                </div>
              )}
            </div>
          </div>
        </Card>

        {/* Second, against the card above: the switch belongs within sight of
            the drawing it turns into an icon. */}
        <AvatarCard seed={patron} role="organizer" />

        {/* Verified domains: the organizer's public identity, checkable by anyone */}
        <MyDomains
          address={wallet.address}
          getSigner={() => wallet.getSigner()}
          withWalletApp={wallet.withWalletApp}
        />

        {/* The wallet: the organizer's identity, not an accessory to it */}
        <Card className="p-5 mb-4">
          <h2 className="text-sm font-semibold text-on-surface flex items-center gap-2 mb-3">
            <Wallet className={cn('w-4 h-4 shrink-0', roleAccent('organizer'))} />
            {t('profile.linked_wallet')}
          </h2>
          {wallet.address ? (
            <>
              <p className="text-xs text-on-surface font-mono break-all">{wallet.address}</p>
              <p className="text-xs text-on-surface-meta mt-2">{t('profile.wallet_note')}</p>
            </>
          ) : (
            <p className="text-sm text-on-surface-meta">{t('profile.no_wallet_linked')}</p>
          )}
        </Card>

        {/* Same offer as the voter profile makes, the other way round.
            An organizer is a person who may also want to vote, and until the
            header could switch roles there was nowhere to say so. */}
        <OtherRoleCard role="voter" />

        <Card className="p-5 mb-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-on-surface flex items-center gap-2">
              <Languages className={cn('w-4 h-4 shrink-0', roleAccent('organizer'))} />
              {t('landing.footer.language')}
            </p>
            <LanguageSelector align="right" />
          </div>
        </Card>

        {/* Legal links, mobile only (desktop sees them in the footer) */}
        {/* The footer's links, for the screens where the footer is hidden. */}
        <SiteLinksCard />

        {/* Sign out, of this role or of both when both are held. */}
        <Card className="p-5">
          <SignOutActions role="organizer" />
        </Card>

      </div>
    </PageLayout>
  );
}
