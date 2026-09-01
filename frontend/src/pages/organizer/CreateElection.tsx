import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2, ChevronRight, AlertTriangle } from 'lucide-react';
import { PageLayout } from '../../components/layout/PageLayout';
import { Stepper } from '../../components/ui/Stepper';
import { Button } from '../../components/ui/Button';
import { BackButton } from '../../components/ui/BackButton';
import { Card } from '../../components/ui/Card';
import { Input, Textarea } from '../../components/ui/Input';
import { DatePicker } from '../../components/ui/DatePicker';
import { SelectMenu } from '../../components/ui/SelectMenu';
import { CountryPicker } from '../../components/ui/CountryPicker';
import { Switch } from '../../components/ui/Switch';
import { RadioGroup } from '../../components/ui/RadioCard';
import { Modal } from '../../components/ui/Modal';
import { TransactionPendingModal, type TxState } from '../../components/ui/TransactionPendingModal';
import { useOrganizerWallet } from '../../hooks/useOrganizerWallet';
import { getGasBalance } from '../../lib/organizer';
import { relayErrorMessage } from '../../lib/relay';
import { hasDuplicateNames, collidesWithBlankVote } from '../../lib/ballotNames';
import { fetchOrganizerDomains } from '../../lib/organizerDomains';
import { isChainConfigured, chainInfo } from '../../lib/deployments';
import { getReadProvider } from '../../lib/contracts';
import { createElection, getOrganizerName, type VOTING_TYPE_ENUM } from '../../lib/organizer';
import {
  fetchAttester,
  hasAttributeRules,
  isEmptyPolicy,
  normaliseCountries,
  requiresNationalityReveal,
  MAX_COUNTRY_LIST,
  MIN_AGE_FLOOR,
  MAX_AGE_CEILING,
  PERSONHOOD_LEVELS,
  type EligibilityPolicy,
  type PersonhoodLevel,
} from '../../lib/eligibility';

interface Candidate { name: string; description: string }

interface FormState {
  title: string;
  description: string;
  votingType: keyof typeof VOTING_TYPE_ENUM;
  threshold: string;
  /** When false there is no separate enrollment window: it opens on deploy and
   *  closes when voting starts. Enrollment itself is never optional: voting
   *  proves membership of the election's Semaphore group. */
  separateEnrollment: boolean;
  enrollStart: string;
  enrollEnd: string;
  voteStart: string;
  voteEnd: string;
  candidates: Candidate[];
  /** How distinct a human the election insists each voter is. */
  personhood: PersonhoodLevel;
  privacyQuorum: string;
  depositAmount: string;
  /** Attribute restrictions. Off by default: an open election is the norm. */
  eligibilityEnabled: boolean;
  minAge: string;
  countryMode: CountryMode;
  /** Selected ISO 3166-1 alpha-3 codes, chosen through CountryPicker. */
  countries: string[];
}

type CountryMode = 'none' | 'allow' | 'block';

const INITIAL: FormState = {
  title: '', description: '', votingType: 'simple_plurality', threshold: '2',
  separateEnrollment: true,
  enrollStart: '', enrollEnd: '', voteStart: '', voteEnd: '',
  candidates: [{ name: '', description: '' }, { name: '', description: '' }],
  // Document by default. An election whose only bar is a World ID account is
  // one account one vote, and accounts are not people; the organizer can still
  // choose that, but not by not noticing the question.
  personhood: 'document', privacyQuorum: '10', depositAmount: '0.05',
  eligibilityEnabled: false, minAge: '', countryMode: 'none', countries: [],
};

/**
 * Turns the wizard's fields into the policy that gets hashed into the contract.
 *
 * Returns an empty policy whenever the toggle is off, so the "no policy"
 * sentinel is produced by exactly one code path.
 */
function policyFromForm(form: FormState): EligibilityPolicy {
  const policy: EligibilityPolicy = {};

  // Independent of the attribute toggle: an election can demand a real document
  // without caring how old its holder is or where they are from. Omitted at
  // `device` so an unrestricted election still hashes to the zero sentinel.
  if (form.personhood !== 'device') policy.personhood = form.personhood;

  if (!form.eligibilityEnabled) return policy;

  const age = Number(form.minAge);
  if (form.minAge.trim() !== '' && Number.isInteger(age)) policy.minAge = age;

  // normaliseCountries still runs even though the picker only ever emits valid
  // codes: it is what sorts them, and the policy hash depends on that order.
  const codes = normaliseCountries(form.countries);
  if (codes.length > 0) {
    if (form.countryMode === 'allow') policy.allowedCountries = codes;
    if (form.countryMode === 'block') policy.blockedCountries = codes;
  }
  return policy;
}

/**
 * Only a witness threshold is inherently a single proposition: it counts
 * confirmations, so there is nothing to confirm on a multi-option ballot. A
 * two-thirds supermajority is a threshold RULE, and applies just as well to a
 * field of candidates (nobody wins below two thirds), so it gets the normal
 * candidate step.
 */
/**
 * Length bounds, counted in CODE POINTS rather than `.length`, which counts
 * UTF-16 units and so scores one emoji as two.
 *
 * The floors differ on purpose. A title is descriptive, so three is safe in
 * every language. A candidate is usually a person, and CJK personal names are
 * commonly two characters (李明), so two is the floor there: a stricter rule
 * would reject perfectly ordinary names.
 *
 * A minimum is a weak filter against junk, since "aa" clears it as easily as
 * "a" does. Its real job is catching a slip before it becomes permanent, which
 * on chain it is. The ceilings matter more: description and candidates travel
 * on chain inside metadataJson, and ElectionV4 rejects the absurd in bytes.
 */
const LIMITS = {
  title: { min: 3, max: 100 },
  description: { min: 10, max: 2000 },
  candidateName: { min: 2, max: 80 },
} as const;

const chars = (value: string) => [...value.trim()].length;

const isYesNo = (vt: string) => vt === 'witness_threshold';

/**
 * Lower bound WITH the time, so a picker cannot offer an hour that has already
 * passed. Day granularity alone let an organizer choose today at 09:00 at six
 * in the evening, which the chain then reads as a deadline in the past.
 */
/**
 * How far ahead of the clock the earliest selectable vote start sits, when
 * enrolment has no window of its own.
 *
 * In that mode `enrollStart` is stamped at submission and `enrollEnd` IS the
 * vote start, so offering the current instant hands the organizer a deployment
 * the contract refuses: by the time the transaction mines, enrollStart is no
 * longer before enrollEnd and it reverts with InvalidConfig. A picker should
 * never offer a value its own validation rejects.
 */
const MIN_VOTE_LEAD_MS = 5 * 60 * 1000;

const nowValue = (nowMs: number) => {
  const d = new Date(nowMs);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

type FieldErrors = Partial<Record<
  'title' | 'description' | 'threshold' | 'enrollStart' | 'enrollEnd' | 'voteStart'
  | 'voteEnd' | 'candidates' | 'privacyQuorum' | 'depositAmount'
  | 'minAge' | 'countries' | 'eligibility', string>>;

/**
 * Per-step validation.
 *
 * These rules mirror `ElectionV4`'s constructor requirements (which revert with
 * `InvalidConfig`). Catching them here avoids sending a transaction that is
 * guaranteed to fail: the organizer would pay gas for nothing and get an
 * opaque revert instead of a readable message.
 */
/**
 * @param nowMs The CHAIN's clock, not the browser's. `phase()` compares against
 *   `block.timestamp`, so a deadline judged future here and past on chain
 *   produces an election born ACTIVE with an enrolment window nobody can use.
 *   They diverge by days on a local node whose time was advanced by seeding.
 */
function validateStep(
  step: number,
  form: FormState,
  t: (k: string, vars?: Record<string, unknown>) => string,
  nowMs: number,
  /**
   * Set when `nowMs` came from a chain whose clock runs ahead of this browser's.
   * "Must be in the future" then reads as plainly wrong to an organizer looking
   * at their own calendar, so the message names the clock that actually decides.
   */
  chainNowLabel?: string,
  /**
   * False when the backend could not name an attester. A gated election is
   * deployed with that address frozen in, so creating one without it produces
   * an election nobody can ever enroll in. Blocking here beats letting the
   * deploy fail with a message about a missing argument.
   */
  attesterAvailable = true,
): FieldErrors {
  const notFuture = () =>
    chainNowLabel
      ? t('validation.must_be_future_chain', { time: chainNowLabel })
      : t('validation.must_be_future');
  const e: FieldErrors = {};
  const day = (s: string) => (s ? new Date(s).getTime() : NaN);

  if (step === 0) {
    if (!form.title.trim()) e.title = t('validation.required');
    else if (chars(form.title) < LIMITS.title.min) {
      e.title = t('validation.too_short', { min: LIMITS.title.min });
    } else if (chars(form.title) > LIMITS.title.max) {
      e.title = t('validation.too_long', { max: LIMITS.title.max });
    }

    if (!form.description.trim()) e.description = t('validation.required');
    else if (chars(form.description) < LIMITS.description.min) {
      e.description = t('validation.too_short', { min: LIMITS.description.min });
    } else if (chars(form.description) > LIMITS.description.max) {
      e.description = t('validation.too_long', { max: LIMITS.description.max });
    }
    if (form.votingType === 'witness_threshold') {
      const n = Number(form.threshold);
      if (!Number.isInteger(n) || n < 1) e.threshold = t('validation.threshold_min');
    }
  }

  if (step === 1) {
    const [es, ee, vs, ve] = [
      day(form.enrollStart), day(form.enrollEnd), day(form.voteStart), day(form.voteEnd),
    ];
    if (!form.voteStart) e.voteStart = t('validation.required');
    if (!form.voteEnd) e.voteEnd = t('validation.required');

    if (form.separateEnrollment) {
      if (!form.enrollStart) e.enrollStart = t('validation.required');
      if (!form.enrollEnd) e.enrollEnd = t('validation.required');

      // Contract: enrollStart < enrollEnd <= voteStart < voteEnd
      if (!e.enrollEnd && !Number.isNaN(es) && ee <= es) e.enrollEnd = t('validation.after_enroll_start');
      if (!e.voteStart && !Number.isNaN(ee) && vs < ee) e.voteStart = t('validation.after_enroll_end');
      // Relative ordering is not enough: a window that has ALREADY closed
      // satisfies all of it. The contract's phase() reads the clock, so an
      // election whose enrollEnd is past is born ACTIVE, skipping enrolment
      // entirely, and nobody can ever join it. An enrollStart in the past is
      // fine and means enrolment opens on deploy; only the END has to be ahead.
      // Measured against the chain clock: see the nowMs parameter.
      if (!e.enrollEnd && !Number.isNaN(ee) && ee <= nowMs) {
        e.enrollEnd = notFuture();
      }
    } else if (!e.voteStart && !Number.isNaN(vs) && vs <= nowMs) {
      // Enrollment will run from deploy until voting opens, so that window has
      // to be in the future or the contract's enrollStart < enrollEnd fails.
      e.voteStart = notFuture();
    }

    if (!e.voteEnd && !Number.isNaN(vs) && ve <= vs) e.voteEnd = t('validation.after_vote_start');
    if (!e.voteEnd && !Number.isNaN(ve) && ve < Date.now()) e.voteEnd = t('validation.must_be_future');
  }

  if (step === 2 && !isYesNo(form.votingType)) {
    const names = form.candidates.map(c => c.name.trim()).filter(Boolean);
    if (names.length < 2) e.candidates = t('validation.candidates_min');
    else if (names.some(n => chars(n) < LIMITS.candidateName.min)) {
      e.candidates = t('validation.candidate_too_short', { min: LIMITS.candidateName.min });
    } else if (names.some(n => chars(n) > LIMITS.candidateName.max)) {
      e.candidates = t('validation.candidate_too_long', { max: LIMITS.candidateName.max });
    } else if (hasDuplicateNames(names)) {
      e.candidates = t('validation.candidates_unique');
    } else if (names.some(n => collidesWithBlankVote(n, t('election.blank_vote')))) {
      // Every ballot gets a blank option appended when it is READ, so nothing
      // here ever compared against it and a candidate could be given its exact
      // name. The organizer sees one language, so this refuses the collision in
      // theirs; a reader in another language is covered on the read side.
      e.candidates = t('validation.candidate_blank_clash');
    }
  }

  if (step === 3) {
    const q = Number(form.privacyQuorum);
    if (!Number.isInteger(q) || q < 1) e.privacyQuorum = t('validation.quorum_min');
    const d = Number(form.depositAmount);
    if (Number.isNaN(d) || d < 0) e.depositAmount = t('validation.number_positive');

    if (form.eligibilityEnabled) {
      if (form.minAge.trim() !== '') {
        const age = Number(form.minAge);
        if (!Number.isInteger(age) || age < MIN_AGE_FLOOR || age > MAX_AGE_CEILING) {
          e.minAge = t('validation.min_age_range', { min: MIN_AGE_FLOOR, max: MAX_AGE_CEILING });
        }
      }

      if (form.countryMode !== 'none') {
        if (form.countries.length === 0) e.countries = t('validation.country_list_empty');
        else if (form.countries.length > MAX_COUNTRY_LIST) {
          e.countries = t('validation.country_list_long', { max: MAX_COUNTRY_LIST });
        }
      }

      // A restriction that restricts nothing is a configuration the organizer
      // almost certainly did not mean. Asked of the ATTRIBUTE rules only: the
      // personhood level is a separate answer, and since it now defaults to
      // `document` the whole policy is never empty, which would have retired
      // this check without anyone noticing.
      if (!hasAttributeRules(policyFromForm(form)) && !e.minAge && !e.countries) {
        e.eligibility = t('validation.eligibility_empty');
      }
    }

    // Every level above `device` enrolls through the attested entry point, and
    // that path needs an attester whether or not any attribute is checked.
    // Blocking, not a warning: without one the contract refuses every voter.
    if (!isEmptyPolicy(policyFromForm(form)) && !attesterAvailable && !e.eligibility) {
      e.eligibility = t('create.eligibility_unavailable');
    }
  }

  return e;
}

export default function CreateElection() {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const wallet = useOrganizerWallet();

  // The gas tank is per ORGANIZER, shared by all their elections, so a deposit
  // here is topping up one pool rather than funding this election. Showing the
  // current balance is what makes "you may not need to add anything" visible.
  const [tankBalance, setTankBalance] = useState<number | null>(null);
  useEffect(() => {
    if (!isChainConfigured() || !wallet.address) return;
    let cancelled = false;
    void (async () => {
      try {
        const wei = await getGasBalance(wallet.address!);
        if (!cancelled) setTankBalance(Number(wei) / 1e18);
      } catch {
        if (!cancelled) setTankBalance(null);
      }
    })();
    return () => { cancelled = true; };
  }, [wallet.address]);
  const live = isChainConfigured();
  const [step, setStep]       = useState(0);
  const [form, setForm]       = useState<FormState>(INITIAL);
  const [deployModal, setDeployModal] = useState(false);
  const [txState, setTxState] = useState<TxState>('idle');
  const [txError, setTxError] = useState<string | null>(null);
  // Errors are only surfaced after the user tries to advance, so the form does
  // not shout at them while it is still empty.
  const [showErrors, setShowErrors] = useState(false);

  // Verified domains for the connected organizer. The selector below only shows
  // when there is more than one: with a single domain there is nothing to
  // choose, and with none the field does not exist at all.
  const [domains, setDomains] = useState<string[]>([]);
  const [chosenDomain, setChosenDomain] = useState<string | undefined>(undefined);

  // Address that will sign enrollment attestations, and whether the provider is
  // reachable at all. Fetched once: it is frozen into the election at creation,
  // so an organizer who turns the restriction on without a working attester
  // would deploy a gated election nobody could ever enroll in.
  const [attester, setAttester] = useState<{ address: string; available: boolean } | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const info = await fetchAttester();
        if (!cancelled) setAttester({ address: info.address, available: info.available });
      } catch {
        if (!cancelled) setAttester(null);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // The chain's own clock. Deadlines are judged by `block.timestamp`, so the
  // browser's clock is the wrong reference: a local node whose time was advanced
  // by seeding can sit days ahead, and dates that look comfortably future here
  // are already past there. Falls back to the browser clock when there is no
  // chain to ask, which is the seed-data mode where nothing is deployed anyway.
  const [chainNowMs, setChainNowMs] = useState<number | null>(null);

  useEffect(() => {
    if (!live) return;
    let cancelled = false;
    void (async () => {
      try {
        const block = await getReadProvider().getBlock('latest');
        if (!cancelled && block) setChainNowMs(Number(block.timestamp) * 1000);
      } catch {
        // Leave it null: the browser clock is a better guess than blocking the
        // wizard on a chain read.
      }
    })();
    return () => { cancelled = true; };
  }, [live]);

  // Read once at mount through a lazy initializer: calling Date.now() during
  // render is impure, and a clock that ticks between renders would make the
  // same form validate differently from one keystroke to the next.
  const [browserNowMs] = useState(() => Date.now());
  const nowMs = chainNowMs ?? browserNowMs;

  // A local node seeded with time jumps can sit days ahead of the wall clock.
  // Only worth naming when the gap is real: a few seconds of block drift would
  // make the message noise on a live network.
  const CLOCK_GAP_MS = 5 * 60 * 1000;
  const chainNowLabel =
    chainNowMs !== null && chainNowMs - browserNowMs > CLOCK_GAP_MS
      ? new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' })
          .format(new Date(chainNowMs))
      : undefined;

  useEffect(() => {
    if (!live || !wallet.address) return;
    const organizer = wallet.address;
    let cancelled = false;
    void (async () => {
      try {
        const verified = (await fetchOrganizerDomains(organizer))
          .filter(d => d.status === 'verified')
          .map(d => d.domain);
        if (!cancelled) setDomains(verified);
      } catch {
        // A domain is optional decoration on the election: failing to load the
        // list must never block creating one.
        if (!cancelled) setDomains([]);
      }
    })();
    return () => { cancelled = true; };
  }, [live, wallet.address]);

  // Default to the only domain, or to the first, without asking.
  const activeDomain = chosenDomain ?? domains[0];

  const isDirty = JSON.stringify(form) !== JSON.stringify(INITIAL);
  const [leaveModal, setLeaveModal] = useState(false);
  const pendingNav = useRef<(() => void) | null>(null);

  const guardedNavigate = (action: () => void) => {
    if (isDirty) {
      pendingNav.current = action;
      setLeaveModal(true);
    } else {
      action();
    }
  };
  const cancelLeave = () => { setLeaveModal(false); pendingNav.current = null; };
  const confirmLeave = () => {
    setLeaveModal(false);
    const action = pendingNav.current;
    pendingNav.current = null;
    action?.();
  };

  // Full page unload (refresh, close tab, typed URL, external link): the SPA
  // router never sees these, so this is the only hook available for them.
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  // In-app navigation (top/bottom nav tabs, logo, profile) is a same-document
  // history change, so beforeunload never fires for it: the click has to be
  // caught before React Router acts on it. Nav links carry a real href;
  // TopNav's logo/profile buttons carry a data-nav-href for the same purpose.
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: MouseEvent) => {
      const el = (e.target as HTMLElement).closest('a[href], [data-nav-href]');
      if (!el) return;
      let href: string;
      if (el instanceof HTMLAnchorElement) {
        const url = new URL(el.href, window.location.origin);
        if (url.origin !== window.location.origin) return;
        if (url.pathname + url.search === window.location.pathname + window.location.search) return;
        href = url.pathname + url.search + url.hash;
      } else {
        href = el.getAttribute('data-nav-href') ?? '';
        if (!href || href === window.location.pathname) return;
      }
      e.preventDefault();
      e.stopPropagation();
      guardedNavigate(() => navigate(href));
    };
    document.addEventListener('click', handler, true);
    return () => document.removeEventListener('click', handler, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDirty, navigate]);

  const stepErrors = validateStep(step, form, t, nowMs, chainNowLabel, attester?.available === true);

  /**
   * Without a separate window, enrolment runs from creation until voting opens,
   * so voteStart IS the enrolment deadline. Choosing a start a few hours out
   * leaves voters almost no time to join, and a voter who misses enrolment
   * cannot vote at all. Deliberately a warning and not an error: a short notice
   * is legitimate for a small group that is already waiting, and only the
   * organizer knows which case they are in.
   */
  const SHORT_ENROLMENT_MS = 24 * 60 * 60 * 1000;
  const enrolmentMs = form.voteStart ? new Date(form.voteStart).getTime() - nowMs : NaN;
  // No lower guard on the window itself: a near-zero enrolment time is the worst
  // case this warning exists for, and the previous `> 0` hid it exactly there.
  // A genuinely past start is a different problem with its own error, so that
  // one case defers rather than stacking two messages on one field.
  const shortEnrolment =
    !form.separateEnrollment &&
    !Number.isNaN(enrolmentMs) &&
    enrolmentMs < SHORT_ENROLMENT_MS &&
    !stepErrors.voteStart;
  const stepValid = Object.keys(stepErrors).length === 0;
  const err = (field: keyof FieldErrors) => (showErrors ? stepErrors[field] : undefined);

  // Every step must be valid before deploying: the user could otherwise skip
  // back and blank a field after passing its step.
  const allStepsValid = [0, 1, 2, 3].every(
    s => Object.keys(validateStep(s, form, t, nowMs, chainNowLabel, attester?.available === true)).length === 0,
  );

  const goNext = () => {
    if (!stepValid) { setShowErrors(true); return; }
    setShowErrors(false);
    setStep(s => s + 1);
  };

  const STEPS = [
    { label: t('create.step_info') },
    { label: t('create.step_timeline') },
    { label: t('create.step_candidates') },
    { label: t('create.step_deploy') },
  ];

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm(f => ({ ...f, [k]: v }));

  // Yes/No voting types force exactly two options.
  const effectiveCandidates = isYesNo(form.votingType)
    ? [{ name: 'Yes', description: '' }, { name: 'No', description: '' }]
    : form.candidates;

  const addCandidate = () =>
    set('candidates', [...form.candidates, { name: '', description: '' }]);

  const removeCandidate = (i: number) =>
    set('candidates', form.candidates.filter((_, j) => j !== i));

  const updateCandidate = (i: number, field: keyof Candidate, v: string) =>
    set('candidates', form.candidates.map((c, j) => j === i ? { ...c, [field]: v } : c));

  const handleDeploy = async () => {
    setDeployModal(false);

    // Last line of defence: never send a transaction the contract would reject.
    if (!allStepsValid) {
      setShowErrors(true);
      return;
    }

    // Phase A / no chain: simulate the deploy.
    if (!live) {
      setTxState('pending');
      setTimeout(() => {
        setTxState('success');
        setTimeout(() => navigate('/organizer/dashboard'), 1800);
      }, 2500);
      return;
    }

    setTxState('pending');
    try {
      if (wallet.wrongNetwork) await wallet.switchToAmoy();
      const signer = await wallet.getSigner();
      const candidates = effectiveCandidates
        .filter(c => c.name.trim())
        .map(c => ({ name: c.name.trim(), description: c.description.trim() || undefined }));

      const { address } = await createElection(signer, {
        name: form.title,
        description: form.description,
        votingType: form.votingType,
        thresholdValue: form.votingType === 'witness_threshold' ? Number(form.threshold) : 0,
        organizerName: getOrganizerName(), // from the organizer's profile, not the election title
        // Snapshotted here on purpose: the election keeps the domain it was
        // created under even if the verification lapses later.
        organizerDomain: activeDomain,
        candidates,
        privacyQuorum: Number(form.privacyQuorum),
        // No separate window: enrollment opens now and closes when voting does.
        // (The contract requires enrollStart < enrollEnd <= voteStart.)
        enrollStart: form.separateEnrollment ? new Date(form.enrollStart) : new Date(),
        enrollEnd: form.separateEnrollment ? new Date(form.enrollEnd) : new Date(form.voteStart),
        voteStart: new Date(form.voteStart),
        voteEnd: new Date(form.voteEnd),
        depositMatic: form.depositAmount,
        eligibility: policyFromForm(form),
        eligibilityAttester: attester?.address,
      });

      setTxState('success');
      // `replace`, not push: the election exists now, and leaving a filled-in
      // wizard one step back invites deploying it a second time.
      setTimeout(() => navigate(`/organizer/election/${address}`, { replace: true }), 1800);
    } catch (e) {
      console.error('Deploy failed:', e);
      setTxError(relayErrorMessage(e));
      setTxState('failed');
    }
  };

  return (
    <PageLayout role="organizer" showNav>
      <div className="max-w-2xl mx-auto pt-4 pb-24">
        <BackButton
          className="mb-5"
          onClick={() => step > 0 ? setStep(s => s - 1) : guardedNavigate(() => navigate(-1))}
        />

        <h1 className="text-xl font-black tracking-tight text-white mb-6">{t('create.title')}</h1>
        <Stepper steps={STEPS} current={step} className="mb-8" />

        {/* Step 0: Info */}
        {step === 0 && (
          <Card className="p-5 flex flex-col gap-4">
            <Input label={t('create.election_name')} value={form.title} onChange={e => set('title', e.target.value)} placeholder={t('create.election_name_placeholder')} maxLength={LIMITS.title.max} error={err('title')} />
            <Textarea label={t('create.description')} value={form.description} onChange={e => set('description', e.target.value)} rows={3} placeholder={t('create.description_placeholder')} maxLength={LIMITS.description.max} error={err('description')} />
            <SelectMenu
              label={t('create.voting_type')}
              value={form.votingType}
              onChange={v => set('votingType', v as keyof typeof VOTING_TYPE_ENUM)}
              options={[
                { value: 'simple_plurality',  label: t('voting_type.simple_plurality'),  description: t('voting_type.simple_plurality_desc') },
                { value: 'absolute_majority', label: t('voting_type.absolute_majority'), description: t('voting_type.absolute_majority_desc') },
                { value: 'two_thirds',        label: t('voting_type.two_thirds'),        description: t('voting_type.two_thirds_desc') },
                { value: 'witness_threshold', label: t('voting_type.witness_threshold'), description: t('voting_type.witness_threshold_desc') },
              ]}
            />
            {form.votingType === 'witness_threshold' && (
              <Input
                label={t('create.witness_threshold_n')}
                type="number"
                min="1"
                value={form.threshold}
                onChange={e => set('threshold', e.target.value)}
                hint={t('create.witness_threshold_hint')}
                error={err('threshold')}
              />
            )}
          </Card>
        )}

        {/* Step 1: Timeline */}
        {step === 1 && (
          <Card className="p-5 flex flex-col gap-4">
            <Switch
              label={t('create.separate_enrollment')}
              description={t('create.separate_enrollment_desc')}
              checked={form.separateEnrollment}
              onChange={v => set('separateEnrollment', v)}
            />
            {/* One column on phones: a date + time label does not fit in a half-width field. */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {form.separateEnrollment && (
                <>
                  <DatePicker withTime label={t('create.enroll_start')} value={form.enrollStart} min={nowValue(nowMs)} onChange={v => set('enrollStart', v)} error={err('enrollStart')} />
                  <DatePicker withTime label={t('create.enroll_end')}   value={form.enrollEnd}   min={form.enrollStart || nowValue(nowMs)} onChange={v => set('enrollEnd', v)} error={err('enrollEnd')} />
                </>
              )}
              <DatePicker withTime label={t('create.vote_start')} value={form.voteStart}
                min={
                  form.separateEnrollment
                    ? form.enrollEnd || nowValue(nowMs)
                    : nowValue(nowMs + MIN_VOTE_LEAD_MS)
                }
                onChange={v => set('voteStart', v)} error={err('voteStart')} />
              <DatePicker withTime label={t('create.vote_end')} value={form.voteEnd}
                min={form.voteStart || nowValue(nowMs)}
                onChange={v => set('voteEnd', v)} error={err('voteEnd')} />
            </div>
            {!form.separateEnrollment && (
              <p className="text-xs text-on-surface-meta">{t('create.enrollment_until_vote_start')}</p>
            )}

            {/* Informational, never blocking: the wizard advances regardless. */}
            {shortEnrolment && (
              <div className="flex items-start gap-3 px-4 py-3 rounded-2xl bg-warning/10 border border-warning/25">
                <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
                <p className="text-xs text-warning">{t('create.short_enrollment_warning')}</p>
              </div>
            )}
          </Card>
        )}

        {/* Step 2: Candidates.
            For Yes/No types the block below is a PREVIEW of the ballot, not a
            choice. Both chips carry identical, muted styling on purpose:
            highlighting one read as a selected toggle and had organizers trying
            to click it. Voters pick between the two later, at vote time. */}
        {step === 2 && isYesNo(form.votingType) && (
          <Card className="p-5 text-center">
            <p className="text-sm text-on-surface">{t('create.yes_no_note')}</p>
            <p className="text-xs text-on-surface-meta mt-1">{t('create.yes_no_hint')}</p>
            <p className="text-xs text-on-surface-meta mt-4 mb-2">{t('create.yes_no_preview')}</p>
            <div className="flex justify-center gap-3" aria-hidden="true">
              <span className="px-4 py-2 rounded-xl bg-surface-high/40 text-on-surface-variant text-sm font-semibold">
                {t('common.yes')}
              </span>
              <span className="px-4 py-2 rounded-xl bg-surface-high/40 text-on-surface-variant text-sm font-semibold">
                {t('common.no')}
              </span>
            </div>
          </Card>
        )}
        {step === 2 && !isYesNo(form.votingType) && (
          <div className="flex flex-col gap-3">
            {form.candidates.map((c, i) => (
              <Card key={i} className="p-4 flex gap-3 items-start">
                <div className="flex-1 flex flex-col gap-2">
                  <Input placeholder={t('create.candidate_name')} value={c.name} onChange={e => updateCandidate(i, 'name', e.target.value)} maxLength={LIMITS.candidateName.max} />
                  <Input placeholder={t('create.candidate_desc')} value={c.description} onChange={e => updateCandidate(i, 'description', e.target.value)} maxLength={300} />
                </div>
                {form.candidates.length > 2 && (
                  <button type="button" onClick={() => removeCandidate(i)} className="mt-2 text-error hover:text-error/70 transition-colors cursor-pointer">
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </Card>
            ))}
            <Button variant="ghost" className="gap-2 rounded-2xl" onClick={addCandidate}>
              <Plus className="w-4 h-4" />
              {t('create.add_candidate')}
            </Button>
            {err('candidates') && (
              <p className="text-xs text-error text-center">{err('candidates')}</p>
            )}
            <p className="text-xs text-on-surface-meta text-center">{t('create.blank_vote_note')}</p>
          </div>
        )}

        {/* Step 3: Deploy */}
        {step === 3 && (
          <div className="flex flex-col gap-4">
            <Card className="p-5 flex flex-col gap-4">
              {/* The one question every election answers, restricted or not:
                  how sure does it need to be that two enrollments are two
                  people. The attribute rules below are separate, and optional. */}
              <div className="flex flex-col gap-2">
                <p className="text-sm font-medium text-on-surface">{t('create.personhood')}</p>
                <p className="text-xs text-on-surface-meta">{t('create.personhood_desc')}</p>
                <RadioGroup
                  className="mt-1"
                  value={form.personhood}
                  onChange={v => set('personhood', v as PersonhoodLevel)}
                  options={PERSONHOOD_LEVELS.map(level => ({
                    value: level,
                    label: t(`create.personhood_${level}`),
                    description: t(`create.personhood_${level}_desc`),
                  }))}
                />
              </div>

              {/* Attribute eligibility. Off by default, and deliberately the
                  only place in the wizard that can make enrollment harder:
                  every voter who wants in will have to scan a passport. */}
              <div className="flex flex-col gap-4 pt-1">
                <Switch
                  label={t('create.eligibility_enable')}
                  description={t('create.eligibility_enable_desc')}
                  checked={form.eligibilityEnabled}
                  onChange={v => set('eligibilityEnabled', v)}
                />

                {form.eligibilityEnabled && attester?.available !== true && (
                  <div className="flex items-start gap-3 px-4 py-3 rounded-2xl bg-warning/10 border border-warning/25">
                    <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
                    <p className="text-xs text-warning">{t('create.eligibility_unavailable')}</p>
                  </div>
                )}

                {form.eligibilityEnabled && (
                  <div className="flex flex-col gap-4 pl-1">
                    <Input
                      label={t('create.min_age')}
                      type="number"
                      min={MIN_AGE_FLOOR}
                      max={MAX_AGE_CEILING}
                      value={form.minAge}
                      onChange={e => set('minAge', e.target.value)}
                      hint={t('create.min_age_hint')}
                      error={err('minAge')}
                    />

                    <SelectMenu
                      label={t('create.country_rule')}
                      value={form.countryMode}
                      onChange={v => set('countryMode', v as CountryMode)}
                      options={[
                        { value: 'none', label: t('create.country_rule_none') },
                        { value: 'block', label: t('create.country_rule_block') },
                        { value: 'allow', label: t('create.country_rule_allow') },
                      ]}
                    />

                    {form.countryMode !== 'none' && (
                      <CountryPicker
                        label={form.countryMode === 'allow'
                          ? t('create.countries_allowed')
                          : t('create.countries_blocked')}
                        value={form.countries}
                        onChange={codes => set('countries', codes)}
                        max={MAX_COUNTRY_LIST}
                        hint={t('create.country_picker_hint', { max: MAX_COUNTRY_LIST })}
                        error={err('countries')}
                      />
                    )}

                    {/* The allowlist is the only setting here that costs the
                        voter a disclosure rather than a yes/no answer. Saying
                        so is the difference between an informed choice and a
                        surprise. */}
                    {requiresNationalityReveal(policyFromForm(form)) && (
                      <p className="text-xs text-on-surface-meta">
                        {t('create.nationality_reveal_note')}
                      </p>
                    )}

                    {err('eligibility') && (
                      <p className="text-xs text-error">{err('eligibility')}</p>
                    )}
                  </div>
                )}
              </div>
              <Input label={t('create.privacy_quorum')} type="number" min="1" max="100" value={form.privacyQuorum} onChange={e => set('privacyQuorum', e.target.value)} hint={t('create.quorum_hint')} error={err('privacyQuorum')} />
              <div className="flex flex-col gap-1.5">
                <Input label={t('create.deposit_token', { currency: chainInfo.currency })} type="number" step="0.01" min="0" value={form.depositAmount} onChange={e => set('depositAmount', e.target.value)} hint={t('create.deposit_hint')} error={err('depositAmount')} />
                {tankBalance !== null && (
                  <p className="text-xs text-on-surface-meta">
                    {t('create.current_tank', {
                      amount: tankBalance.toFixed(4),
                      currency: chainInfo.currency,
                    })}
                  </p>
                )}
              </div>

              {/* Only worth asking when there is an actual choice to make. */}
              {domains.length > 1 && (
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="organizer-domain" className="text-sm text-on-surface-variant">
                    {t('domain.select_label')}
                  </label>
                  <select
                    id="organizer-domain"
                    value={activeDomain ?? ''}
                    onChange={e => setChosenDomain(e.target.value || undefined)}
                    className="w-full rounded-2xl bg-white/5 border border-white/10 px-4 py-3 text-sm text-on-surface"
                  >
                    {domains.map(d => <option key={d} value={d}>{d}</option>)}
                    <option value="">{t('domain.select_none')}</option>
                  </select>
                  <p className="text-xs text-on-surface-meta">{t('domain.select_hint')}</p>
                </div>
              )}
            </Card>

            {/* Errors from earlier steps are invisible here, so surface them. */}
            {showErrors && !allStepsValid && (
              <div className="flex items-start gap-3 px-4 py-3 rounded-2xl bg-error/10 border border-error/25">
                <AlertTriangle className="w-4 h-4 text-error shrink-0 mt-0.5" />
                <p className="text-xs text-error">{t('validation.fix_previous_steps')}</p>
              </div>
            )}

            <div className="flex items-start gap-3 px-4 py-3 rounded-2xl bg-warning/10 border border-warning/20">
              <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
              <p className="text-xs text-warning">{t('create.immutability_warning')}</p>
            </div>
          </div>
        )}

        {/* Navigation */}
        <div className="flex gap-3 mt-8">
          {/* Buttons stay enabled on purpose: clicking reveals *why* the step is
              invalid. A disabled button with no explanation is a dead end. */}
          {step < 3 ? (
            <Button variant="gradient" size="lg" className="flex-1 rounded-full h-14 gap-2" onClick={goNext}>
              {t('common.continue')}
              <ChevronRight className="w-4 h-4" />
            </Button>
          ) : (
            <Button
              variant="gradient"
              size="lg"
              className="flex-1 rounded-full h-14"
              onClick={() => { setShowErrors(true); if (allStepsValid) setDeployModal(true); }}
            >
              {t('create.deploy')}
            </Button>
          )}
        </div>

        <Modal
          open={deployModal}
          onClose={() => setDeployModal(false)}
          title={t('create.deploy_confirm_title')}
          description={t('create.deploy_confirm_desc', { amount: form.depositAmount, currency: chainInfo.currency })}
        >
          <div className="flex gap-3 mt-2">
            <Button variant="ghost" className="flex-1" onClick={() => setDeployModal(false)}>{t('common.cancel')}</Button>
            <Button variant="gradient" className="flex-1" onClick={handleDeploy}>{t('create.deploy')}</Button>
          </div>
        </Modal>

        <Modal
          open={leaveModal}
          onClose={cancelLeave}
          title={t('create.leave_confirm_title')}
          description={t('create.leave_confirm_desc')}
        >
          <div className="flex gap-3 mt-2">
            <Button variant="ghost" className="flex-1" onClick={cancelLeave}>{t('common.cancel')}</Button>
            <Button variant="gradient" className="flex-1" onClick={confirmLeave}>{t('create.discard_changes')}</Button>
          </div>
        </Modal>

        <TransactionPendingModal
          state={txState}
          errorMessage={txError ?? undefined}
          onClose={() => { setTxState('idle'); setTxError(null); }}
        />
      </div>
    </PageLayout>
  );
}
