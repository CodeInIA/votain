import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { ShieldCheck, ExternalLink, Copy, Check } from 'lucide-react';
import { PageLayout } from '../../components/layout/PageLayout';
import { Button } from '../../components/ui/Button';
import { BlockchainBadge } from '../../components/ui/BlockchainBadge';
import { getElection } from '../../data/seed';

const DEMO_REF = 'VTN-2025-' + String(Math.floor(Math.random() * 90000) + 10000);

export default function VoteConfirmation() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const election = getElection(id ?? '');
  const [copied, setCopied] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 100);
    return () => clearTimeout(t);
  }, []);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(DEMO_REF);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <PageLayout role="voter" showNav={false}>
      <div className="min-h-dvh flex flex-col items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: visible ? 1 : 0, scale: visible ? 1 : 0.95 }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
          className="w-full max-w-sm bg-surface-low/30 backdrop-blur-3xl rounded-4xl p-8 border border-white/5 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.8)] flex flex-col items-center text-center"
        >
          {/* Checkmark */}
          <div className="relative mb-6">
            <div className="absolute inset-0 bg-green-500/20 blur-[40px] rounded-full" />
            <div className="relative w-24 h-24 rounded-full bg-green-500/10 border border-green-500/20 flex items-center justify-center">
              <ShieldCheck className="w-12 h-12 text-green-400 drop-shadow-[0_0_15px_rgba(74,222,128,0.6)]" strokeWidth={1.5} />
            </div>
          </div>

          <h1 className="text-2xl font-bold text-white mb-2">{t('confirmation.title')}</h1>
          <p className="text-sm text-on-surface-variant mb-6 leading-relaxed">{t('confirmation.desc')}</p>

          {/* Reference number */}
          <div className="w-full mb-4 p-4 rounded-2xl bg-surface-lowest/40 border border-white/5">
            <p className="text-xs text-on-surface-meta mb-1">{t('confirmation.reference')}</p>
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-sm text-on-surface font-semibold">{DEMO_REF}</span>
              <button type="button" onClick={handleCopy}
                className="text-on-surface-meta hover:text-on-surface transition-colors">
                {copied ? <Check className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Election name */}
          {election && (
            <p className="text-xs text-on-surface-meta mb-6 px-2 line-clamp-2">{election.title}</p>
          )}

          {/* Blockchain badge */}
          <div className="mb-6">
            <BlockchainBadge href={`https://amoy.polygonscan.com/tx/0xdemotx`} />
          </div>

          {/* Actions */}
          <div className="flex flex-col gap-3 w-full">
            <a
              href={`https://amoy.polygonscan.com/tx/0xdemotx`}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full"
            >
              <Button variant="default" className="w-full rounded-full gap-2">
                <ExternalLink className="w-4 h-4" />
                {t('confirmation.view_tx')}
              </Button>
            </a>
            <Button variant="ghost" className="w-full rounded-full"
              onClick={() => navigate('/voter/elections')}>
              {t('confirmation.back_elections')}
            </Button>
          </div>
        </motion.div>
      </div>
    </PageLayout>
  );
}
