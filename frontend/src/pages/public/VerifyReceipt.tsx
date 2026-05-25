import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, CheckCircle, XCircle } from 'lucide-react';
import { PageLayout } from '../../components/layout/PageLayout';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { VOTER_HISTORY } from '../../data/seed';

type ResultState = 'idle' | 'found' | 'not-found';

export default function VerifyReceipt() {
  const { t } = useTranslation();
  const [ref, setRef]       = useState('');
  const [state, setState]   = useState<ResultState>('idle');
  const [match, setMatch]   = useState<(typeof VOTER_HISTORY)[0] | null>(null);

  const handleSearch = () => {
    const found = VOTER_HISTORY.find(v =>
      v.referenceNumber.toLowerCase() === ref.trim().toLowerCase() ||
      v.nullifier.toLowerCase().includes(ref.trim().toLowerCase())
    );
    setMatch(found ?? null);
    setState(found ? 'found' : 'not-found');
  };

  return (
    <PageLayout role="public" showNav>
      <div className="max-w-xl mx-auto pt-10 pb-24">
        <div className="text-center mb-10">
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white mb-2">
            {t('verify_receipt.title')}
          </h1>
          <p className="text-sm text-on-surface-variant">{t('verify_receipt.subtitle')}</p>
        </div>

        <div className="flex gap-3 mb-6">
          <div className="flex-1">
            <Input
              placeholder={t('verify_receipt.placeholder')}
              value={ref}
              onChange={e => setRef(e.target.value)}
              leftIcon={<Search className="w-4 h-4" />}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
            />
          </div>
          <Button
            variant="gradient"
            className="rounded-2xl px-5"
            onClick={handleSearch}
            disabled={!ref.trim()}
          >
            {t('common.search')}
          </Button>
        </div>

        {state === 'found' && match && (
          <Card className="p-5">
            <div className="flex items-center gap-3 mb-4">
              <CheckCircle className="w-6 h-6 text-success shrink-0" />
              <div>
                <p className="text-sm font-bold text-success">{t('verify_receipt.found')}</p>
                <p className="text-xs text-on-surface-meta">{t('verify_receipt.vote_recorded')}</p>
              </div>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-on-surface-meta">{t('verify_receipt.election')}</span>
                <span className="text-on-surface font-medium text-right max-w-xs truncate">{match.electionTitle}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-on-surface-meta">{t('verify_receipt.reference')}</span>
                <span className="text-on-surface font-mono">{match.referenceNumber}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-on-surface-meta">{t('verify_receipt.nullifier')}</span>
                <span className="text-on-surface font-mono text-xs">{match.nullifier}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-on-surface-meta">{t('verify_receipt.date')}</span>
                <span className="text-on-surface">{match.date.toLocaleDateString()}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-on-surface-meta">{t('verify_receipt.status')}</span>
                <Badge variant={match.phase as Parameters<typeof Badge>[0]['variant']}>{t(`phase.${match.phase}`)}</Badge>
              </div>
            </div>
          </Card>
        )}

        {state === 'not-found' && (
          <Card className="p-5 flex items-center gap-3">
            <XCircle className="w-6 h-6 text-error shrink-0" />
            <div>
              <p className="text-sm font-bold text-error">{t('verify_receipt.not_found')}</p>
              <p className="text-xs text-on-surface-meta">{t('verify_receipt.not_found_desc')}</p>
            </div>
          </Card>
        )}

        {state === 'idle' && (
          <p className="text-xs text-center text-on-surface-meta mt-4">
            {t('verify_receipt.hint')}
          </p>
        )}
      </div>
    </PageLayout>
  );
}
