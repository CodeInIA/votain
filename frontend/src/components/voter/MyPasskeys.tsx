/**
 * Passkey device manager.
 *
 * A voter has one Semaphore identity, derived from a recovery phrase that is
 * sealed once per passkey in the encrypted vault. Registering the passkey of the
 * device you are on means you stop reaching for another device (the QR / hybrid
 * prompt), or typing the words, every time you vote here.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Smartphone, Plus, Trash2, Check, ShieldAlert } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card } from '../ui/Card';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Spinner } from '../ui/Spinner';
import { useToast } from '../ui/useToast';
import {
  fetchVault,
  LastPasskeyError,
  removeVaultEntry,
  type VaultEntry,
} from '../../lib/identityVault';
import { enrollThisDevice } from '../../lib/semaphore';
import { prfReadbackFailed } from '../../lib/passkeyPrf';
import { vaultWritePending } from '../../lib/semaphore';
import {
  getCachedCredentialId,
  PasskeyAlreadyRegisteredError,
  PasskeyCancelledError,
} from '../../lib/passkeyPrf';

export function MyPasskeys() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [entries, setEntries] = useState<VaultEntry[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [busy, setBusy] = useState<boolean>(false);
  /**
   * The credential a confirmation is open for.
   *
   * Removing one writes a transaction and takes away a way into the identity,
   * and it used to happen on the first click of a small icon. Worse, the
   * confirmation is the only place the LIMIT of removing can be explained: it
   * changes which copies the chain serves and erases nothing from its history,
   * so for a stolen device the answer is rotating the identity, not this.
   */
  const [confirming, setConfirming] = useState<string | null>(null);
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
      // NOTALLOWEDERROR MEANS TWO THINGS AND WEBAUTHN WILL NOT SAY WHICH.
      //
      // It is returned for a dismissed dialog and for most platform refusals
      // alike, deliberately, so that a page cannot learn whether a credential
      // exists. `registerCredential` turns it into `PasskeyCancelledError`,
      // which is the right guess for a first enrolment and the wrong one here:
      // measured on Windows adding a SECOND passkey over the QR transport, the
      // browser showed "there was a problem saving your passkey" and the voter,
      // who had cancelled nothing, was told they had.
      //
      // So the message names BOTH, and points at the thing that actually helps.
      // Only once the vault already holds one, because with an empty vault
      // there is nothing to have refused a duplicate and a dismissal is the
      // only reading left.
      if (error instanceof PasskeyCancelledError && entries.length > 0) {
        toast({ title: t('devices.error'), description: t('devices.add_refused'), variant: 'warning' });
        console.error('Could not link a passkey:', error);
        return;
      }
      // LOGGED AS WELL AS SHOWN. A toast carries a sentence a person can act
      // on; it drops the one thing a diagnosis needs, which is what the
      // authenticator actually said. This failure was invisible in the console
      // for exactly that reason, while the browser showed its own dialog and
      // the real name of the DOMException reached nobody.
      console.error('Could not link a passkey:', error);
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
      setConfirming(null);
      reload();
    } catch (error: unknown) {
      // TWO SITUATIONS, AND THEY USED TO SHARE A BRANCH. Every failure reported
      // "link another passkey before removing this one", so a backend that was
      // down or a reverted transaction sent the voter off to create a
      // credential they did not need, and the real problem went unnamed. The
      // backend already distinguishes: it answers `last_passkey` for the one
      // case where that sentence is true.
      const isLast = error instanceof LastPasskeyError;
      toast({
        title: isLast ? t('devices.last_passkey') : t('devices.remove_failed'),
        description: isLast ? undefined : error instanceof Error ? error.message : undefined,
        variant: isLast ? 'warning' : 'error',
      });
    } finally {
      setBusy(false);
    }
  };

  /** Whether the credential THIS browser has cached is one of the registered ones. */
  const registered = thisDevice !== null && entries.some(e => e.credentialId === thisDevice);

  return (
    <Card className="p-5 mb-4">
      <p className="text-sm font-semibold text-on-surface">{t('devices.title')}</p>
      <p className="text-xs text-on-surface-meta mt-1 mb-4">{t('devices.desc')}</p>

      {/* A passkey that works and never reached the chain. Set during setup when
          the seal succeeded and the vault write did not, and read HERE because
          this is where the retry lives: without somewhere to say it, the flag
          was written by one screen and never looked at again, and the voter was
          left believing a device was registered that the chain has never heard
          of. Cleared by the next write that gets through. */}
      {vaultWritePending() !== null && (
        <div className="flex items-start gap-3 p-3 mb-4 rounded-2xl bg-warning/10 border border-warning/20">
          <ShieldAlert className="w-4 h-4 text-warning shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-warning">
              {t('recovery.unregistered_title')}
            </p>
            <p className="text-xs text-on-surface-meta leading-relaxed mt-0.5">
              {t('recovery.unregistered_desc')}
            </p>
          </div>
        </div>
      )}

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
                    onClick={() => setConfirming(entry.credentialId)}
                    aria-label={t('devices.remove')}
                    className="p-2 rounded-lg text-on-surface-meta hover:text-red-400 hover:bg-white/5 cursor-pointer disabled:opacity-40"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            );
          })}

          {/* Said alongside the offer, never instead of it. This device failing
              is a fact about ONE authenticator, the one it reaches by default;
              a phone offered over a QR code is a different one and may work.
              Hiding the button here took away the option that still had a
              chance. */}
          {/* About the authenticator this machine reaches by default, so it is
              worth saying only while that one is still the untried option. */}
          {!registered && prfReadbackFailed() && (
            <p className="text-xs text-on-surface-meta leading-relaxed px-3 pt-2">
              {t('devices.cannot_seal')}
            </p>
          )}

          {/* ALWAYS OFFERED, and it used to vanish the moment this browser's own
              passkey was in the list. That confused "this device is registered"
              with "there is nothing left to add", and they are different
              questions: a voter with a laptop passkey still wants their phone,
              a second laptop, a security key. Linking one is exactly how this
              list stops being a single point of failure, and the screen was
              hiding the button from everybody who had got far enough to need
              it.
              Adding another is already the supported shape: `enrollThisDevice`
              passes the registered ids as `excludeCredentials`, so the
              authenticator refuses a duplicate and the browser offers the rest,
              the QR to a phone included. */}
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => void handleAdd()}
            className="justify-start gap-3 px-3 py-3 h-auto rounded-xl hover:bg-white/5 text-sm text-on-surface-variant hover:text-on-surface mt-1"
          >
            {busy ? <Spinner className="w-4 h-4" /> : <Plus className="w-4 h-4 shrink-0" />}
            {busy ? t('devices.adding') : t('devices.add')}
          </Button>
        </div>
      )}

      <Modal
        open={confirming !== null}
        onClose={() => setConfirming(null)}
        title={t('devices.remove_title')}
        description={t('devices.remove_desc')}
      >
        {/* Named here and nowhere else, because this is the moment somebody is
            thinking about a device they no longer trust. Quiet, since rotating
            costs every election they had already joined. */}
        <p className="text-xs text-on-surface-meta leading-relaxed mt-2">
          {t('devices.remove_stolen')}{' '}
          <Link
            to="/voter/re-verify"
            className="text-primary-dim font-semibold underline underline-offset-4 hover:text-primary"
          >
            {t('reverify.title')}
          </Link>
        </p>

        <div className="flex gap-3 mt-4">
          <Button variant="ghost" className="flex-1" onClick={() => setConfirming(null)}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="default"
            className="flex-1 border-error/30 text-error hover:bg-error/10"
            disabled={busy}
            onClick={() => void handleRemove(confirming as string)}
          >
            {busy ? <Spinner className="w-4 h-4" /> : t('devices.remove_confirm')}
          </Button>
        </div>
      </Modal>
    </Card>
  );
}
