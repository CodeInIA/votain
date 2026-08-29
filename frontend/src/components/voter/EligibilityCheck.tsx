/**
 * Attribute check before enrolling in a restricted election.
 *
 * The voter opens the Self app, holds an identity document against the phone,
 * and the app produces a zero-knowledge proof of the facts this election asked
 * for. A biometric passport or a national identity card both work, and the voter
 * uses whichever they hold. The document is read from its own chip and never
 * leaves that device: what reaches
 * Votain is a yes or no per rule, and, only when the election names allowed
 * countries, the nationality itself, which is compared and discarded.
 *
 * The QR is drawn from the deep link the backend built with Self's own builder,
 * rather than through `@selfxyz/qrcode`. That component is a React wrapper from
 * the legacy SDK whose job is drawing a QR and holding a websocket open; the
 * drawing is three lines with a library this app already has, and the websocket
 * is redundant because the proof reaches our server directly and this component
 * polls the session for the outcome. Keeping it out also keeps its React version
 * constraints out.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { QRCodeSVG } from 'qrcode.react';
import { ShieldCheck, AlertTriangle } from 'lucide-react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Spinner } from '../ui/Spinner';
import {
  openEligibilitySession,
  pollEligibilitySession,
  claimAttestation,
  requiresNationalityReveal,
  type EligibilityChallenge,
  type EligibilityPolicy,
} from '../../lib/eligibility';
import { usePolicyRequirements } from '../../hooks/usePolicyRequirements';
import { getOrCreateIdentity } from '../../lib/semaphore';
import type { EnrollAttestationInput } from '../../lib/relay';

const POLL_INTERVAL_MS = 2500;

/** Consecutive failed polls tolerated before giving up. */
const MAX_POLL_FAILURES = 4;

// Same test as WorldIdVerify, and for the same reason: a QR is useless on the
// device that holds the app being scanned for. Read once at module load, as
// there is that component's precedent and nothing here reacts to it changing.
const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

interface Props {
  election: string;
  policy: EligibilityPolicy;
  /** Handed the attestation once the check passes; the caller then enrolls. */
  onVerified: (attestation: EnrollAttestationInput) => void;
  onCancel: () => void;
}

type Stage = 'idle' | 'opening' | 'waiting' | 'claiming' | 'passed' | 'failed' | 'error';

export function EligibilityCheck({ election, policy, onVerified, onCancel }: Props) {
  const { t } = useTranslation();
  const [stage, setStage] = useState<Stage>('idle');
  const [challenge, setChallenge] = useState<EligibilityChallenge | null>(null);
  const [reason, setReason] = useState<string | null>(null);

  // Kept in a ref so the polling effect can stop itself without re-subscribing
  // every time the stage changes.
  //
  // The reset on the way IN is what makes this correct, not tidiness. StrictMode
  // mounts, unmounts and mounts again in development; the cleanup from that first
  // simulated unmount sets the flag, and a ref survives the remount, so without
  // this line the flag stays true for the component's whole life and every poll
  // tick returns immediately. The symptom is a QR that never advances even
  // though the verification succeeded.
  const cancelled = useRef(false);
  useEffect(() => {
    cancelled.current = false;
    return () => { cancelled.current = true; };
  }, []);

  // The parent passes an inline arrow, so this prop is a new function on every
  // render. Listing it as an effect dependency would clear and recreate the
  // polling interval each time, and a timer that keeps restarting never fires.
  const onVerifiedRef = useRef(onVerified);
  useEffect(() => { onVerifiedRef.current = onVerified; }, [onVerified]);

  const start = useCallback(async () => {
    setStage('opening');
    setReason(null);
    try {
      const opened = await openEligibilitySession(election);
      setChallenge(opened);
      setStage('waiting');
    } catch (error: unknown) {
      setReason(error instanceof Error ? error.message : String(error));
      setStage('error');
    }
  }, [election]);

  // Polls our own backend rather than Self's websocket: the result we care
  // about is the one our server reached, and a second transport would only add
  // a way for the two to disagree.
  useEffect(() => {
    if (stage !== 'waiting' || !challenge) return;

    let stop = false;
    let failures = 0;
    const timer = setInterval(async () => {
      if (stop || cancelled.current) return;
      try {
        const { status, reason: why } = await pollEligibilitySession(challenge.sessionId);
        if (stop || cancelled.current) return;

        if (status === 'passed') {
          // The interval stops here, so from this point nothing will retry on
          // our behalf: the claim needs its own terminal failure, or a cancelled
          // passkey prompt or a refused signature would leave the voter on a
          // spinner with no button to press.
          stop = true;
          setStage('claiming');
          try {
            const identity = await getOrCreateIdentity();
            const attestation = await claimAttestation(
              election,
              challenge.sessionId,
              identity.commitment,
            );
            if (!cancelled.current) {
              setStage('passed');
              onVerifiedRef.current(attestation);
            }
          } catch (claimError: unknown) {
            if (cancelled.current) return;
            setReason(claimError instanceof Error ? claimError.message : String(claimError));
            setStage('error');
          }
        } else if (status === 'failed') {
          stop = true;
          setReason(why ?? 'unknown');
          setStage('failed');
        }
      } catch (error: unknown) {
        // A vanished session is final: it expired, or the server restarted and
        // lost its in-memory store. Anything else is treated as a blip and
        // retried, because giving up on one failed request would strand a voter
        // whose phone is mid-scan over a momentary hiccup.
        const message = error instanceof Error ? error.message : String(error);
        if (/expired|not your session/i.test(message)) {
          stop = true;
          setStage('error');
          setReason('expired');
          return;
        }

        failures += 1;
        if (failures >= MAX_POLL_FAILURES) {
          stop = true;
          setStage('error');
          setReason(message);
        }
      }
    }, POLL_INTERVAL_MS);

    return () => { stop = true; clearInterval(timer); };
  }, [stage, challenge, election]);

  const requirements = usePolicyRequirements(policy);

  return (
    <Card className="p-5 flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <ShieldCheck className="w-5 h-5 text-primary shrink-0 mt-0.5" />
        <div>
          <h3 className="text-sm font-bold text-white">{t('eligibility.title')}</h3>
          <p className="text-xs text-on-surface-meta mt-1">{t('eligibility.intro')}</p>
        </div>
      </div>

      <ul className="flex flex-col gap-1.5">
        {requirements.map(requirement => (
          <li key={requirement} className="text-xs text-on-surface-variant flex gap-2">
            <span aria-hidden="true">&bull;</span>
            {requirement}
          </li>
        ))}
      </ul>

      <p className="text-xs text-on-surface-meta">
        {requiresNationalityReveal(policy)
          ? t('eligibility.privacy_note_reveal')
          : t('eligibility.privacy_note')}
      </p>

      {stage === 'idle' && (
        <div className="flex gap-3">
          <Button variant="primary" onClick={() => void start()}>{t('eligibility.start')}</Button>
          <Button variant="ghost" onClick={onCancel}>{t('common.cancel')}</Button>
        </div>
      )}

      {stage === 'opening' && (
        <div className="flex items-center gap-3 text-xs text-on-surface-meta">
          <Spinner size="sm" />
          {t('eligibility.opening')}
        </div>
      )}

      {stage === 'waiting' && challenge && (
        <div className="flex flex-col items-center gap-4">
          {/* The two ways in are mutually exclusive, not a QR with a link under
              it. On a phone the Self app is on this very device, so there is
              nothing to scan and the tappable link is the whole flow; it carries
              a return address, so the app brings the voter back here instead of
              leaving them to find the browser again. On a desktop the app is on
              a different device, so the QR is the only bridge and a callback
              would redirect the wrong screen. */}
          {isMobile ? (
            <div className="flex flex-col items-center gap-3 w-full">
              <a
                href={challenge.mobileLink}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full px-6 py-4 bg-white text-black font-semibold rounded-2xl flex items-center justify-center gap-3 shadow-lg active:scale-95 transition-transform"
              >
                <ShieldCheck className="w-5 h-5" />
                {t('eligibility.open_app')}
              </a>
              <p className="text-xs text-on-surface-meta text-center px-2">
                {t('eligibility.mobile_return_hint')}
              </p>
            </div>
          ) : (
            <>
              <div className="bg-white p-3 rounded-2xl">
                <QRCodeSVG value={challenge.universalLink} size={200} level="M" />
              </div>
              <p className="text-xs text-on-surface-meta text-center">
                {t('eligibility.scan_hint')}
              </p>
            </>
          )}

          <div className="flex items-center gap-2 text-xs text-on-surface-meta">
            <Spinner size="sm" />
            {t('eligibility.waiting')}
          </div>

          {challenge.mock && (
            <p className="text-[11px] text-warning">{t('eligibility.mock_mode')}</p>
          )}

          <Button variant="ghost" onClick={onCancel}>{t('common.cancel')}</Button>
        </div>
      )}

      {stage === 'claiming' && (
        <div className="flex items-center gap-3 text-xs text-on-surface-meta">
          <Spinner size="sm" />
          {t('eligibility.claiming')}
        </div>
      )}

      {(stage === 'failed' || stage === 'error') && (
        <div className="flex flex-col gap-3">
          <div className="flex items-start gap-3 px-4 py-3 rounded-2xl bg-error/10 border border-error/25">
            <AlertTriangle className="w-4 h-4 text-error shrink-0 mt-0.5" />
            <p className="text-xs text-error">
              {stage === 'failed'
                ? t(`eligibility.failed_${reason ?? 'unknown'}`, {
                    defaultValue: t('eligibility.failed_unknown'),
                  })
                : t('eligibility.error')}
            </p>
          </div>
          <div className="flex gap-3">
            <Button variant="primary" onClick={() => void start()}>{t('common.retry')}</Button>
            <Button variant="ghost" onClick={onCancel}>{t('common.cancel')}</Button>
          </div>
        </div>
      )}
    </Card>
  );
}
