import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Fuel, ArrowDownLeft } from 'lucide-react';
import { PageLayout } from '../../components/layout/PageLayout';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { GasWidget } from '../../components/ui/GasWidget';
import { useToast } from '../../components/ui/Toast';

const HISTORY = [
  { type: 'deposit', amount: 1.0,  date: new Date(Date.now() - 5 * 86_400_000),  hash: '0xabc1…' },
  { type: 'spent',   amount: -0.12, date: new Date(Date.now() - 3 * 86_400_000),  hash: '0xdef2…' },
  { type: 'spent',   amount: -0.08, date: new Date(Date.now() - 1 * 86_400_000),  hash: '0xghi3…' },
];

export default function GasManagement() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [amount, setAmount] = useState('1.0');

  const handleDeposit = () => {
    toast({ title: t('gas.deposit_pending'), description: t('common.integration_pending'), variant: 'info' });
  };

  return (
    <PageLayout role="organizer" showNav>
      <div className="max-w-xl mx-auto pt-6 pb-24">
        <h1 className="text-2xl font-black tracking-tight text-white mb-6">{t('gas.title')}</h1>

        {/* Current balance */}
        <GasWidget balanceMatic={0.8} estimatedVotesLeft={26} onDeposit={handleDeposit} className="mb-6" />

        {/* Deposit form */}
        <Card className="p-5 mb-6">
          <h2 className="text-sm font-semibold text-on-surface mb-4 flex items-center gap-2">
            <Fuel className="w-4 h-4 text-primary" />
            {t('gas.deposit_title')}
          </h2>
          <div className="flex gap-3">
            <div className="flex-1">
              <Input
                label={t('gas.amount_matic')}
                type="number"
                step="0.1"
                min="0.1"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                hint={t('gas.amount_hint')}
              />
            </div>
          </div>
          <div className="flex gap-2 mt-3">
            {['0.5', '1.0', '2.0', '5.0'].map(v => (
              <button
                key={v}
                type="button"
                onClick={() => setAmount(v)}
                className={[
                  'flex-1 py-1.5 rounded-xl text-xs font-semibold border transition-all',
                  amount === v
                    ? 'bg-primary/10 border-primary/30 text-primary-dim'
                    : 'bg-surface-low/30 border-outline-variant/20 text-on-surface-meta hover:text-on-surface',
                ].join(' ')}
              >
                {v}
              </button>
            ))}
          </div>
          <Button variant="gradient" size="lg" className="w-full rounded-full h-12 mt-4" onClick={handleDeposit}>
            {t('gas.deposit_btn', { amount })}
          </Button>
        </Card>

        {/* History */}
        <Card className="p-5">
          <h2 className="text-sm font-semibold text-on-surface mb-4">{t('gas.history')}</h2>
          <div className="flex flex-col gap-2">
            {HISTORY.map((h, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className={[
                  'w-8 h-8 rounded-xl flex items-center justify-center shrink-0',
                  h.type === 'deposit' ? 'bg-success/10 text-success' : 'bg-surface-high text-on-surface-meta',
                ].join(' ')}>
                  {h.type === 'deposit' ? <ArrowDownLeft className="w-4 h-4" /> : <Fuel className="w-4 h-4" />}
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-on-surface">
                    {h.type === 'deposit' ? t('gas.deposit') : t('gas.used')}
                  </p>
                  <p className="text-xs text-on-surface-meta font-mono">{h.hash}</p>
                </div>
                <div className="text-right">
                  <p className={['text-sm font-semibold', h.amount > 0 ? 'text-success' : 'text-on-surface-meta'].join(' ')}>
                    {h.amount > 0 ? '+' : ''}{h.amount.toFixed(4)} MATIC
                  </p>
                  <p className="text-xs text-on-surface-meta">{h.date.toLocaleDateString()}</p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </PageLayout>
  );
}
