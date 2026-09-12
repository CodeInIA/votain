import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Download, ExternalLink, ShieldCheck, ShieldAlert } from 'lucide-react';
import { PageLayout } from '../../components/layout/PageLayout';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { BackButton } from '../../components/ui/BackButton';
import { Card } from '../../components/ui/Card';
import { ResultBarChart } from '../../components/ui/BarChart';
import { BlockchainBadge, IPFSBadge } from '../../components/ui/BlockchainBadge';
import { Spinner } from '../../components/ui/Spinner';
import { useElection } from '../../hooks/useElections';
import { explorerAddressUrl } from '../../lib/deployments';

export default function ElectionResults() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { election, loading } = useElection(id);

  if (loading) {
    return (
      <PageLayout role="public" showNav>
        <div className="flex items-center justify-center min-h-[60vh]"><Spinner /></div>
      </PageLayout>
    );
  }

  if (!election || !election.candidates.some(c => c.votes !== undefined)) {
    return (
      <PageLayout role="public" showNav>
        <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
          <span className="text-5xl mb-4">📊</span>
          <h2 className="text-xl font-bold text-on-surface mb-2">{t('results.not_available')}</h2>
          <Button variant="ghost" onClick={() => navigate(-1)}>{t('common.back')}</Button>
        </div>
      </PageLayout>
    );
  }

  const totalVotes = election.candidates.reduce((s, c) => s + (c.votes ?? 0), 0);
  const winner     = election.candidates.find(c => c.isWinner);
  const hasTie     = election.candidates.some(c => c.isTie);

  const handleExport = () => {
    const data = {
      election: election.title,
      contractAddress: election.contractAddress,
      ipfsCid: election.ipfsCid,
      totalVotes,
      results: election.candidates.map(c => ({
        name: c.name,
        votes: c.votes ?? 0,
        pct: totalVotes > 0 ? Math.round(((c.votes ?? 0) / totalVotes) * 1000) / 10 : 0,
      })),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `votain-results-${election.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <PageLayout role="public" showNav>
      <div className="max-w-3xl mx-auto pt-4 pb-24">
        <BackButton className="mb-6" />

        {/* Header */}
        <div className="mb-6">
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <Badge variant="closed">{t('phase.closed')}</Badge>
            <BlockchainBadge href={explorerAddressUrl(election.contractAddress) ?? undefined} />
            {election.ipfsCid && <IPFSBadge href={`https://ipfs.io/ipfs/${election.ipfsCid}`} />}
          </div>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white mb-1">
            {t('results.title')}
          </h1>
          <p className="text-sm text-on-surface-variant break-words">{election.title}</p>
        </div>

        {/* Summary card */}
        <Card className="p-5 mb-4">
          <div className="flex flex-wrap gap-6">
            <div>
              <p className="text-xs text-on-surface-meta mb-0.5">{t('results.total_votes')}</p>
              <p className="text-2xl font-bold text-on-surface">{totalVotes.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-xs text-on-surface-meta mb-0.5">{t('results.participation')}</p>
              <p className="text-2xl font-bold text-on-surface">
                {election.totalEnrolled > 0
                  ? Math.round((totalVotes / election.totalEnrolled) * 100)
                  : 0}%
              </p>
            </div>
            {winner && (
              <div>
                <p className="text-xs text-on-surface-meta mb-0.5">{t('results.winner')}</p>
                <p className="text-base font-bold text-primary">{winner.name}</p>
              </div>
            )}
            {hasTie && (
              <Badge variant="tie" className="self-center">{t('badge.tie')}</Badge>
            )}
          </div>
        </Card>

        {/* Bar chart */}
        <Card className="p-5 mb-6">
          <h2 className="text-sm font-semibold text-on-surface mb-4">{t('results.breakdown')}</h2>
          <ResultBarChart candidates={election.candidates as Parameters<typeof ResultBarChart>[0]['candidates']} totalVotes={totalVotes} />
        </Card>

        {/* What a reader can check for themselves, with no key and no CLI */}
        {election.tallyCheck && (
          <Card className="p-5 mb-6">
            <div className="flex items-start gap-3">
              {election.tallyCheck.matches ? (
                <ShieldCheck className="w-5 h-5 text-success shrink-0 mt-0.5" />
              ) : (
                <ShieldAlert className="w-5 h-5 text-error shrink-0 mt-0.5" />
              )}
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-on-surface mb-1">
                  {t(election.tallyCheck.matches ? 'results.check_ok_title' : 'results.check_bad_title')}
                </h2>
                <p className="text-xs text-on-surface-variant">
                  {t(election.tallyCheck.matches ? 'results.check_ok_body' : 'results.check_bad_body', {
                    declared: election.tallyCheck.declared,
                    voters: election.tallyCheck.voters,
                  })}
                </p>
                <p className="text-xs text-on-surface-meta mt-2">{t('results.check_limit')}</p>
              </div>
            </div>
          </Card>
        )}

        {/* Transparency actions */}
        <div className="flex flex-wrap gap-3">
          <Button variant="default" size="sm" className="rounded-full gap-2" onClick={handleExport}>
            <Download className="w-4 h-4" />
            {t('results.export_json')}
          </Button>
          {election.ipfsCid && (
            <a
              href={`https://ipfs.io/ipfs/${election.ipfsCid}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button variant="ghost" size="sm" className="rounded-full gap-2">
                <ExternalLink className="w-4 h-4" />
                {t('results.view_ipfs')}
              </Button>
            </a>
          )}
        </div>
      </div>
    </PageLayout>
  );
}
