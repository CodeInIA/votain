/**
 * Passkey device manager.
 *
 * A voter has one Semaphore identity, sealed once per passkey in the encrypted
 * vault. Registering the passkey of the device you are on means you stop having
 * to reach for another device (the QR / hybrid prompt) every time you vote here.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Smartphone, Plus, Trash2, Check } from 'lucide-react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Spinner } from '../ui/Spinner';
import { useToast } from '../ui/useToast';
import { fetchVault, removeVaultEntry, type VaultEntry } from '../../lib/identityVault';
import { enrollThisDevice } from '../../lib/semaphore';
import { getCachedCredentialId, PasskeyAlreadyRegisteredError } from '../../lib/passkeyPrf';

export function MyDevices() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [entries, setEntries] = useState<VaultEntry[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [busy, setBusy] = useState<boolean>(false);
  // Bumped after a write to re-run the fetch effect.
  const [reloadToken, setReloadToken] = useState<number>(0);
  // Re-read after every write: enrolling this device caches a new credential id,
  // and a value captured once at first render would keep showing the old one.
  const [thisDevice, setThisDevice] = useState<string | null>(getCachedCredentialId);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const vault = await fetchVault();
        if (!cancelled) {
          setEntries(vault?.entries ?? []);
          setThisDevice(getCachedCredentialId());
        }
      } catch {
        if (!cancelled) setEntries([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  const reload = (): void => setReloadToken(n => n + 1);

  const handleAdd = async (): Promise<void> => {
    setBusy(true);
    try {
      // Already registered is not a failure: the authenticator holds one of the
      // voter's passkeys, which happens on the same machine in a second browser.
      // enrollThisDevice caches its id, so the reload below marks this entry as
      // "this device" and drops the add button.
      const { alreadyRegistered } = await enrollThisDevice();
      toast({
        title: alreadyRegistered ? t('devices.already_registered') : t('devices.added'),
        variant: alreadyRegistered ? 'info' : 'success',
      });
      reload();
    } catch (error: unknown) {
      // Same situation, but the voter dismissed the prompt that would have
      // identified the credential, so there is no id to cache.
      if (error instanceof PasskeyAlreadyRegisteredError) {
        toast({ title: t('devices.already_registered'), variant: 'info' });
        reload();
        return;
      }
      toast({
        title: t('devices.error'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'error',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (credentialId: string): Promise<void> => {
    setBusy(true);
    try {
      await removeVaultEntry(credentialId);
      reload();
    } catch (error: unknown) {
      toast({
        title: t('devices.last_passkey'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'warning',
      });
    } finally {
      setBusy(false);
    }
  };

  const registered = thisDevice !== null && entries.some(e => e.credentialId === thisDevice);

  return (
    <Card className="p-5 mb-4">
      <p className="text-sm font-semibold text-on-surface">{t('devices.title')}</p>
      <p className="text-xs text-on-surface-meta mt-1 mb-4">{t('devices.desc')}</p>

      {loading ? (
        <div className="flex justify-center py-4">
          <Spinner />
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {entries.length === 0 && (
            <p className="text-xs text-on-surface-meta py-2">{t('devices.empty')}</p>
          )}

          {entries.map(entry => {
            const isThis = entry.credentialId === thisDevice;
            return (
              <div
                key={entry.credentialId}
                className="flex items-center gap-3 rounded-xl bg-white/5 px-3 py-2.5"
              >
                <Smartphone className="w-4 h-4 shrink-0 text-on-surface-variant" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-on-surface truncate font-mono">
                    {entry.credentialId.slice(0, 16)}…
                  </p>
                  <p className="text-xs text-on-surface-meta">
                    {new Date(entry.addedAt).toLocaleDateString()}
                  </p>
                </div>
                {isThis && (
                  <span className="flex items-center gap-1 text-xs text-green-400 shrink-0">
                    <Check className="w-3 h-3" />
                    {t('devices.this_device')}
                  </span>
                )}
                {entries.length > 1 && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleRemove(entry.credentialId)}
                    aria-label={t('devices.remove')}
                    className="p-2 rounded-lg text-on-surface-meta hover:text-red-400 hover:bg-white/5 cursor-pointer disabled:opacity-40"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            );
          })}

          {!registered && (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => void handleAdd()}
              className="justify-start gap-3 px-3 py-3 h-auto rounded-xl hover:bg-white/5 text-sm text-on-surface-variant hover:text-on-surface mt-1"
            >
              {busy ? <Spinner className="w-4 h-4" /> : <Plus className="w-4 h-4 shrink-0" />}
              {busy ? t('devices.adding') : t('devices.add')}
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}
