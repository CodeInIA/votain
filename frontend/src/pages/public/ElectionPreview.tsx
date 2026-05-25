import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Users, Calendar, ChevronLeft, Lock, ExternalLink } from 'lucide-react';
import { PageLayout } from '../../components/layout/PageLayout';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Countdown } from '../../components/ui/Countdown';
import { BlockchainBadge } from '../../components/ui/BlockchainBadge';
import { EligibilityRow } from '../../components/ui/EligibilityRow';
import { getElection } from '../../data/seed';

export default function ElectionPreview() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const election = getElection(id ?? '');

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

  const isActive   = election.phase === 'active';
  const isClosed   = ['closed', 'voided', 'cancelled'].includes(election.phase);
  const hasResults = election.phase === 'closed' && election.ipfsCid;

  return (
    <PageLayout role="public" showNav>
      <div className="max-w-3xl mx-auto pt-4 pb-24">
        {/* Back */}
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="flex items-center gap-1.5 text-sm text-on-surface-meta hover:text-on-surface mb-6 transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
          {t('common.back')}
        </button>

        {/* Title block */}
        <div className="mb-6">
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <Badge variant={election.phase as Parameters<typeof Badge>[0]['variant']} dot={isActive || election.phase === 'enrolling'}>
              {t(`phase.${election.phase}`)}
            </Badge>
            <BlockchainBadge href={`https://amoy.polygonscan.com/address/${election.contractAddress}`} />
          </div>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white mb-2">
            {election.title}
          </h1>
          <p className="text-sm text-on-surface-meta">{t('election.by')} {election.organizer}</p>
        </div>

        {/* Countdown */}
        {isActive && (
          <Card className="p-4 mb-4 flex items-center gap-4 flex-wrap">
            <div>
              <p className="text-xs text-on-surface-meta mb-1">{t('election.voting_closes')}</p>
              <Countdown deadline={election.voteEnd} size="lg" />
            </div>
            <div className="flex-1 h-2 rounded-full bg-surface-high overflow-hidden min-w-24">
              <div
                className="h-full rounded-full bg-primary/60"
                style={{ width: `${Math.round((election.castVotes / election.totalEnrolled) * 100)}%` }}
              />
            </div>
            <div className="text-right">
              <p className="text-lg font-bold text-on-surface">{election.castVotes.toLocaleString()}</p>
              <p className="text-xs text-on-surface-meta">{t('election.votes_cast')}</p>
            </div>
          </Card>
        )}

        {/* Description */}
        <Card className="p-5 mb-4">
          <h2 className="text-sm font-semibold text-on-surface mb-2">{t('election.about')}</h2>
          <p className="text-sm text-on-surface-variant leading-relaxed">{election.description}</p>
          <div className="flex flex-wrap gap-4 mt-4 pt-4 border-t border-white/5 text-xs text-on-surface-meta">
            <span className="flex items-center gap-1.5"><Users className="w-3.5 h-3.5" />{election.totalEnrolled.toLocaleString()} {t('election.enrolled')}</span>
            <span className="flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" />{election.voteEnd.toLocaleDateString()}</span>
          </div>
        </Card>

        {/* Candidates */}
        <Card className="p-5 mb-4">
          <h2 className="text-sm font-semibold text-on-surface mb-3">{t('election.candidates')}</h2>
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
        </Card>

        {/* Eligibility */}
        <Card className="p-5 mb-6">
          <h2 className="text-sm font-semibold text-on-surface mb-3">{t('election.eligibility')}</h2>
          <div>
            {election.eligibility.map(e => (
              <EligibilityRow key={e.id} label={e.label} status={e.status} description={e.description} />
            ))}
          </div>
        </Card>

        {/* CTA */}
        {!isClosed ? (
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
        ) : hasResults ? (
          <Button variant="default" className="w-full sm:w-auto rounded-full"
            onClick={() => navigate(`/election/${election.id}/results`)}>
            {t('election.view_results')}
            <ExternalLink className="w-4 h-4 ml-2" />
          </Button>
        ) : null}
      </div>
    </PageLayout>
  );
}
