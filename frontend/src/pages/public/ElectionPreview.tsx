import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Lock, ExternalLink } from 'lucide-react';
import { PageLayout } from '../../components/layout/PageLayout';
import { Button } from '../../components/ui/Button';
import { BackButton } from '../../components/ui/BackButton';
import { ViewAsSwitch } from '../../components/ui/ViewAsSwitch';
import { organizerViewHref, canManageElection } from '../../lib/electionViews';
import { Card } from '../../components/ui/Card';
import {
  ElectionAbout,
  ElectionHeader,
  ElectionSchedule,
} from '../../components/ui/ElectionSummary';
import { EligibilityRow } from '../../components/ui/EligibilityRow';
import { Spinner } from '../../components/ui/Spinner';
import { StatusNotice } from '../../components/ui/StatusNotice';
import { useElection } from '../../hooks/useElections';
import { usePolicyRequirements } from '../../hooks/usePolicyRequirements';
import { ResultBarChart } from '../../components/ui/BarChart';
import { hasPublishedResults, tallyTotal } from '../../data/seed';
import { useAuth } from '../../contexts/AuthContext';
import { useOrganizerWallet } from '../../hooks/useOrganizerWallet';
import { usePageMeta } from '../../seo/usePageMeta';

export default function ElectionPreview() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { voterLoggedIn, organizerLoggedIn } = useAuth();
  const wallet = useOrganizerWallet();
  const { election, loading } = useElection(id);
  // Falls back to the site name until the chain answers, rather than
  // flashing "undefined" into the tab and into a crawler snapshot.
  usePageMeta({ title: election?.title, description: election?.description });

  // Computed with optional chaining so it sits above the loading and not-found
  // early returns, where the election may not exist yet.
  const canManage = canManageElection(
    organizerLoggedIn,
    wallet.address,
    election?.organizerAddress,
  );

  // Verified against the contract's hash when the election was read.
  const policyRequirements = usePolicyRequirements(election?.eligibilityPolicy);

  if (loading) {
    return (
      <PageLayout role="public" showNav>
        <div className="flex items-center justify-center min-h-[60vh]"><Spinner /></div>
      </PageLayout>
    );
  }

  if (!election) {
    return (
      <PageLayout role="public" showNav>
        <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
          <span className="text-5xl mb-4">🗳️</span>
          <h2 className="text-xl font-bold text-on-surface mb-2">{t('errors.not_found')}</h2>
          <Button variant="ghost" onClick={() => navigate('/discover')}>{t('common.back')}</Button>
        </div>
      </PageLayout>
    );
  }

  const hasResults = hasPublishedResults(election);

  const voterPage = `/voter/election/${election.id}`;

  const infoPanel = (message: string) => <StatusNotice message={message} />;

  const ctaButton = (label: string, to: string) => (
    <Button variant="gradient" className="w-full sm:w-auto rounded-full px-6" onClick={() => navigate(to)}>
      {label}
    </Button>
  );

  /**
   * The footer CTA depends on the election's phase and, for the live phases,
   * on what this voter can actually do next. A terminal phase offers the same
   * thing to everyone, so those are resolved before the auth check.
   */
  const renderCta = () => {
    switch (election.phase) {
      case 'upcoming':
        return infoPanel(t('election.cta_upcoming'));
      case 'pending_vote':
        return infoPanel(t('election.cta_pending_vote'));
      case 'cancelled':
        return infoPanel(t('election.cta_cancelled'));
      case 'voided':
        return infoPanel(t('election.cta_voided'));
      case 'closed':
        // See ElectionDetail: the breakdown is already on the page.
        return hasResults ? null : infoPanel(t('results.not_available'));
      case 'tallying':
        return infoPanel(t('election.cta_tallying'));
    }

    // Live phases (enrolling / active): these need a verified identity.
    if (!voterLoggedIn) {
      return (
        <div className="bg-surface-low/30 backdrop-blur-xl rounded-3xl border border-white/5 p-5 flex flex-col sm:flex-row items-center gap-4">
          <div className="flex items-center gap-3">
            <Lock className="w-5 h-5 text-on-surface-meta shrink-0" />
            <p className="text-sm text-on-surface-variant">{t('election.auth_cta')}</p>
          </div>
          <Button variant="gradient" className="w-full sm:w-auto rounded-full px-6"
            onClick={() => navigate('/voter/onboarding')}>
            {t('election.verify_to_vote')}
          </Button>
        </div>
      );
    }

    if (election.phase === 'enrolling') {
      return election.isEnrolled
        ? infoPanel(t('election.already_enrolled'))
        : ctaButton(t('election.enroll'), voterPage);
    }

    // active
    if (election.hasVoted) return ctaButton(t('election.change_vote'), voterPage);
    if (election.isEnrolled) return ctaButton(t('election.vote_now'), voterPage);
    // Enrollment closed before this voter joined, so they cannot vote here.
    return infoPanel(t('election.cta_not_enrolled'));
  };

  return (
    <PageLayout role="public" showNav>
      <div className="max-w-3xl mx-auto pt-4 pb-24">
        <div className="flex items-center justify-between gap-3 mb-6">
          <BackButton />
          {canManage && (
            <ViewAsSwitch to="organizer" href={organizerViewHref(election.id)} />
          )}
        </div>

        <ElectionHeader election={election} />

        <ElectionSchedule election={election} />

        <ElectionAbout election={election} />

        {/* Candidates, or the result once there is one. Someone opening a decided
            election's link is asking who won; the numbers are already on chain,
            so answering with a bare list and a link elsewhere withholds it. */}
        <Card className="p-5 mb-4">
          <h2 className="text-sm font-semibold text-on-surface mb-3">
            {hasResults ? t('results.breakdown') : t('election.candidates')}
          </h2>
          {hasResults ? (
            <>
              <ResultBarChart
                candidates={election.candidates as Parameters<typeof ResultBarChart>[0]['candidates']}
                totalVotes={tallyTotal(election)}
              />
              <Button
                variant="ghost"
                size="sm"
                className="mt-4"
                onClick={() => navigate(`/election/${election.id}/results`)}
              >
                {t('election.view_results')}
                <ExternalLink className="w-3.5 h-3.5 ml-1.5" />
              </Button>
            </>
          ) : (
            <div className="flex flex-col gap-2">
              {election.candidates.map(c => (
                <div key={c.id} className="flex items-center gap-3 p-3 rounded-xl bg-surface-lowest/40 border border-white/5">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary shrink-0">
                    {c.name.charAt(0)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-on-surface">{c.name}</p>
                    {c.description && <p className="text-xs text-on-surface-meta">{c.description}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Eligibility */}
        <Card className="p-5 mb-6">
          <h2 className="text-sm font-semibold text-on-surface mb-3">{t('election.eligibility')}</h2>
          <div>
            {election.eligibility.map(e => (
              <EligibilityRow key={e.id} label={e.label} status={e.status} description={e.description} />
            ))}
            {policyRequirements.map(requirement => (
              <EligibilityRow key={requirement} label={requirement} status="unknown" />
            ))}
          </div>
        </Card>

        {/* CTA */}
        {renderCta()}
      </div>
    </PageLayout>
  );
}
