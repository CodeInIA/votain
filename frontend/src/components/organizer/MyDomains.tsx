/**
 * Domain verification for the organizer.
 *
 * The organizer publishes a TXT record naming their wallet address and we look
 * it up. DNS is the source of truth, not us: we only remember which domains to
 * check, and every read re-checks live. Removing the record is the revocation,
 * and it takes effect at once.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Globe, Plus, Trash2, Copy, Check, AlertTriangle } from 'lucide-react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Spinner } from '../ui/Spinner';
import { useToast } from '../ui/useToast';
import {
  addOrganizerDomain,
  fetchDomainRecord,
  fetchOrganizerDomains,
  removalMessage,
  removeOrganizerDomain,
  type DomainCheck,
  type DomainRecord,
} from '../../lib/organizerDomains';

export function MyDomains({
  address,
  signMessage,
}: {
  address?: string;
  signMessage: (message: string) => Promise<string>;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [domains, setDomains] = useState<DomainCheck[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState('');
  const [record, setRecord] = useState<DomainRecord | null>(null);
  const [outcome, setOutcome] = useState<DomainCheck | null>(null);
  const [copied, setCopied] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    // The wallet connects lazily, so `address` can still be undefined here. The
    // early exit lives inside the async body rather than the effect body so no
    // state is set synchronously during the effect.
    void (async () => {
      try {
        const list = address ? await fetchOrganizerDomains(address) : [];
        if (!cancelled) setDomains(list);
      } catch {
        if (!cancelled) setDomains([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [address, reloadToken]);

  const showRecord = async (): Promise<void> => {
    if (!address || !draft.trim()) return;
    setBusy(true);
    setOutcome(null);
    try {
      setRecord(await fetchDomainRecord(address, draft.trim()));
    } catch (error: unknown) {
      toast({
        title: t('domain.invalid'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'error',
      });
    } finally {
      setBusy(false);
    }
  };

  const check = async (): Promise<void> => {
    if (!address || !record) return;
    setBusy(true);
    try {
      const result = await addOrganizerDomain(address, draft.trim());
      setOutcome(result);
      if (result.status === 'verified') {
        toast({ title: t('domain.verified'), variant: 'success' });
        setDraft('');
        setRecord(null);
        setOutcome(null);
        setReloadToken(n => n + 1);
      }
    } catch (error: unknown) {
      toast({
        title: t('domain.invalid'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'error',
      });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (domain: string): Promise<void> => {
    if (!address) return;
    setBusy(true);
    try {
      // Signed so nobody else can drop a competitor's domain from the list.
      const signature = await signMessage(removalMessage(domain));
      await removeOrganizerDomain(address, domain, signature);
      setReloadToken(n => n + 1);
    } catch (error: unknown) {
      toast({
        title: t('domain.remove_failed'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'error',
      });
    } finally {
      setBusy(false);
    }
  };

  const copy = (value: string): void => {
    void navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  /** Each outcome is fixed differently, so each one says something different. */
  const outcomeMessage = (result: DomainCheck): string => {
    if (result.status === 'no_record') return t('domain.error_no_record');
    if (result.status === 'address_mismatch') {
      return t('domain.error_mismatch', { found: (result.found ?? []).join(', ') });
    }
    return t('domain.error_lookup');
  };

  return (
    <Card className="p-5 mb-4">
      <p className="text-sm font-semibold text-on-surface">{t('domain.title')}</p>
      <p className="text-xs text-on-surface-meta mt-1 mb-4">{t('domain.desc')}</p>

      {loading ? (
        <div className="flex justify-center py-4"><Spinner /></div>
      ) : (
        <div className="flex flex-col gap-2">
          {domains.length === 0 && (
            <p className="text-xs text-on-surface-meta py-1">{t('domain.empty')}</p>
          )}

          {domains.map(entry => {
            const lapsed = entry.status === 'no_record' || entry.status === 'address_mismatch';
            return (
              <div key={entry.domain} className="flex items-center gap-3 rounded-xl bg-white/5 px-3 py-2.5">
                <Globe className={`w-4 h-4 shrink-0 ${lapsed ? 'text-on-surface-meta' : 'text-primary-dim'}`} />
                <div className="flex-1 min-w-0">
                  <p className={`text-sm truncate ${lapsed ? 'text-on-surface-meta line-through' : 'text-on-surface'}`}>
                    {entry.domain}
                  </p>
                  {lapsed && (
                    <p className="text-xs text-warning">{outcomeMessage(entry)}</p>
                  )}
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void remove(entry.domain)}
                  aria-label={t('domain.remove')}
                  className="p-2 rounded-lg text-on-surface-meta hover:text-red-400 hover:bg-white/5 cursor-pointer disabled:opacity-40"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            );
          })}

          {!record ? (
            <div className="flex gap-2 mt-1">
              <Input
                value={draft}
                onChange={e => setDraft(e.target.value)}
                placeholder={t('domain.placeholder')}
                disabled={busy || !address}
                onKeyDown={e => { if (e.key === 'Enter') void showRecord(); }}
              />
              <Button
                variant="ghost"
                disabled={busy || !draft.trim() || !address}
                onClick={() => void showRecord()}
                className="shrink-0 gap-2"
              >
                <Plus className="w-4 h-4" />
                {t('domain.add')}
              </Button>
            </div>
          ) : (
            <div className="rounded-xl bg-white/5 p-3 mt-1 flex flex-col gap-2">
              <p className="text-xs text-on-surface-variant">{t('domain.publish_instructions')}</p>

              {([['domain.record_name', record.name], ['domain.record_value', record.value]] as const).map(
                ([labelKey, value]) => (
                  <div key={labelKey} className="flex items-center gap-2">
                    <span className="text-xs text-on-surface-meta w-16 shrink-0">{t(labelKey)}</span>
                    <code className="text-xs text-on-surface font-mono break-all flex-1">{value}</code>
                    <button
                      type="button"
                      onClick={() => copy(value)}
                      aria-label={t('domain.copy')}
                      className="p-1.5 rounded-lg text-on-surface-meta hover:text-on-surface hover:bg-white/5 cursor-pointer shrink-0"
                    >
                      {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                ),
              )}

              <p className="text-xs text-on-surface-meta">{t('domain.record_type')}</p>

              {outcome && outcome.status !== 'verified' && (
                <div className="flex items-start gap-2 text-xs text-warning">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>{outcomeMessage(outcome)}</span>
                </div>
              )}

              <div className="flex gap-2">
                <Button variant="ghost" className="flex-1" disabled={busy} onClick={() => { setRecord(null); setOutcome(null); }}>
                  {t('common.cancel')}
                </Button>
                <Button className="flex-1 gap-2" disabled={busy} onClick={() => void check()}>
                  {busy ? <Spinner className="w-4 h-4" /> : null}
                  {t('domain.check_now')}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
