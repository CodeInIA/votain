/**
 * Semaphore V4 identity + membership-proof helpers.
 *
 * The identity is a pure function of a twelve-word RECOVERY PHRASE, so the same
 * words rebuild the same voter on any device, with no server and no passkey.
 * Where the phrase is kept differs, and only that:
 *   1. Sealed under a passkey, in the on-chain vault: the phrase is derived on
 *      demand from a WebAuthn PRF secret that never leaves the authenticator.
 *      Nothing sensitive is at rest, so XSS cannot exfiltrate the voting key.
 *   2. localStorage: the phrase itself, XSS-exposed and clearly marked. Used
 *      where no authenticator can hold it, and kept alongside a sealed copy
 *      until this device has PROVEN it can read one back (see passkeyPrf.ts).
 *
 * The derived Identity is cached in memory for the session either way.
 *
 * The commitment is deterministic per device, so the same identity is obtained at
 * World ID verification time (to register it on-chain) and later at vote time.
 * Proofs are generated against the election's on-chain LeanIMT group.
 */
import { Identity } from "@semaphore-protocol/identity";
import {
  clearPhraseOnDevice,
  hasPhraseOnDevice,
  readPhraseOnDevice,
  sealPhraseOnDevice,
} from "./deviceSeal";
import { getRegistry } from "./contracts";
import { isChainConfigured } from "./deployments";
import { Group } from "@semaphore-protocol/group";
import { generateProof, type SemaphoreProof } from "@semaphore-protocol/proof";
import { poseidon2 } from "poseidon-lite/poseidon2";
import { solidityPackedKeccak256, keccak256, zeroPadValue, toBeHex } from "ethers";
import { getElection } from "./contracts";
import { queryLogsFrom } from "./logs";
import {
  assertPrf,
  enrollPrfPasskey,
  hasPrfCredential,
  clearPrfCredential,
  clearPrfReadback,
  notePrfReadbackFailed,
  prfReadbackFailed,
  prfReadbackProven,
  PasskeyAlreadyRegisteredError,
  type PrfAssertion,
} from "./passkeyPrf";
import { generateRecoveryPhrase, identityFromPhrase, normalizePhrase } from "./recoveryPhrase";
import { forgetElectionIdentities } from "./electionIdentity";
import {
  fetchVault,
  putVaultEntry,
  registerCommitment,
  recoverIdentity,
  unwrapSecret,
  wrapSecret,
  type VaultState,
} from "./identityVault";

const IDENTITY_MODE_KEY = "votain_identity_mode"; // "prf" | "local"

/**
 * The phrase is now sealed under a passkey. Keep the local copy until this
 * device has PROVEN it can read one back, and no longer.
 *
 * The copy is the weaker store, exposed to anything that can run script here,
 * so it is not kept a moment past its usefulness. It is also the only thing
 * standing between a voter on Windows and a phrase they can no longer reach.
 */
/**
 * The phrase lives on this device, in the clear.
 *
 * One operation with one meaning, written in five places before this existed
 * and named in none of them except a closure inside `adoptRecoveryPhrase`. The
 * two keys go together: the words are worth nothing to `getOrCreateIdentity`
 * unless the mode says to read them, and a mode saying "local" with no words is
 * a voter with no way in. `phraseIsUnprotected` is exactly this state seen from
 * outside.
 */
async function keepPhraseOnDevice(phrase: string): Promise<void> {
  // Encrypted under a key this browser cannot read back. See `deviceSeal`,
  // including what that is and is not worth.
  await sealPhraseOnDevice(phrase);
  localStorage.setItem(IDENTITY_MODE_KEY, "local");
}

async function noteSealed(phrase: string): Promise<void> {
  localStorage.setItem(IDENTITY_MODE_KEY, "prf");
  if (prfReadbackProven()) {
    await clearPhraseOnDevice();
  } else {
    // The passkey holds a copy that nothing here has managed to read yet, so
    // the device keeps one too. Sealed, like every other copy on this device.
    await sealPhraseOnDevice(phrase);
  }
}

/**
 * An assertion returned the sealed secret, so the vault is readable here and
 * the local copy has no further use. `assertPrf` records the capability itself,
 * at the one place it is ever proven; this only acts on it.
 */
function noteReadBack(): void {
  localStorage.setItem(IDENTITY_MODE_KEY, "prf");
  // Fire and forget: the vault is proven readable, so nothing depends on this
  // finishing, and the marker it clears is what any later read consults.
  void clearPhraseOnDevice();
}

/**
 * THE PHRASE IS NO LONGER ANNOUNCED TO A MODAL, and that is the point.
 *
 * It used to be published to an in-memory listener the instant it was minted,
 * and a modal mounted near the router put it on screen. One variable, one
 * moment, no second chance: any reload between minting and rendering (a dev
 * server restarting, a phone evicting a backgrounded tab during a WebAuthn
 * ceremony that goes through a QR code and another device) left a voter with an
 * identity and no words, silently, and `noteSealed` had already removed the
 * local copy. It happened in testing and nothing in the logs said so.
 *
 * A phrase is now something a voter walks THROUGH: `beginNewIdentity` mints and
 * stores it, the setup screen shows it and will not move on until it has been
 * copied, and only then does anything else happen. Coming back mid-way finds
 * the same words rather than new ones.
 */
// The PUBLIC identity commitment: safe to persist (it is already on-chain in the
// Semaphore group). Lets read-only UI (enrolled/voted status) work in PRF mode
// after a reload without prompting the passkey. Never holds the secret scalar.
const IDENTITY_COMMITMENT_KEY = "votain_identity_commitment";

// The derived identity is kept in memory for the session so we don't prompt the
// passkey on every read. The secret is never persisted in PRF mode.
let cachedIdentity: Identity | null = null;

/** Caches the identity and remembers its public commitment for read-only checks. */
function remember(id: Identity): Identity {
  cachedIdentity = id;
  localStorage.setItem(IDENTITY_COMMITMENT_KEY, id.commitment.toString());
  return id;
}

// ────────────────────────────────────────────────
// Identity lifecycle
// ────────────────────────────────────────────────

/**
 * Returns the voter's Semaphore identity, deriving it from the passkey PRF when
 * available (prompting the authenticator), or falling back to a localStorage
 * identity. May prompt for a passkey: call from a user gesture.
 */
/**
 * What is about to happen to this voter's identity, decided BEFORE anything
 * asks them for a fingerprint.
 *
 *   has-passkey  - the vault holds sealed copies, so a passkey can open it.
 *   phrase-only  - registered, and no passkey ever held a copy. The twelve
 *                  words are the only way back, which is the ordinary state on
 *                  a device that can create a passkey and never evaluate one.
 *   new          - no identity yet: one will be minted and shown to them.
 *   unknown      - the vault could not be read. Not a state to act on.
 *
 * Reading the vault is a network call and nothing else: no authenticator, no
 * prompt. That is the whole point. The passkey dialog used to appear as a side
 * effect of signing in, with nothing said first, so a voter met it without
 * knowing what it was for and dismissing it was a fright rather than a choice.
 * Knowing the answer first is what lets the interface explain before it asks.
 */
export type IdentityState = "has-passkey" | "phrase-only" | "new" | "unknown";

export async function inspectIdentity(): Promise<IdentityState> {
  try {
    const vault = await fetchVault();
    if (!vault) return "unknown";
    if (vault.entries.length > 0) return "has-passkey";
    return vault.commitment ? "phrase-only" : "new";
  } catch (error: unknown) {
    console.warn("Could not read the identity vault before asking:", error);
    return "unknown";
  }
}

export async function getOrCreateIdentity(): Promise<Identity> {
  if (cachedIdentity) return cachedIdentity;

  // A pre-existing fallback identity must keep being used: its commitment is
  // already registered on-chain, switching to PRF would orphan it.
  //
  // "failed" joins it: this device has already been shown that it cannot read
  // a sealed copy back, so asking again would summon an authenticator dialog
  // that is guaranteed to end in an error, on every page load, forever. The
  // phrase derives the same identity with no prompt at all.
  if (localStorage.getItem(IDENTITY_MODE_KEY) === "local" || prfReadbackFailed()) {
    const stored = await readPhraseOnDevice();
    if (stored) return remember(await identityFromPhrase(stored));
  }

  const outcome = await resolveIdentityFromVault();
  if (outcome.status === "resolved") return outcome.identity;

  // Nothing to resolve and nothing to fall back to: this human has never set
  // an identity up. Said out loud so the caller can send them to the screen
  // that does it, rather than having one made for them behind their back.
  if (outcome.status === "new") throw new IdentityNotSetUpError();

  // The voter HAS an identity but this device could not open it (prompt
  // dismissed, or none of their passkeys reachable here). Falling through would
  // mint a second identity, which the registry would refuse and `enroll` would
  // reject much later with an unrelated error.
  if (outcome.status === "locked") {
    // Unless the phrase is still here, which is the case this whole read-back
    // dance exists for. It derives the SAME identity, so this is a fallback and
    // never a fork. Recorded, so the next load goes straight to it.
    const stored = await readPhraseOnDevice();
    if (stored) {
      notePrfReadbackFailed();
      console.info(
        "This device sealed the phrase under a passkey but cannot evaluate it on an " +
          "assertion. Using the local copy from now on.",
      );
      return remember(await identityFromPhrase(stored));
    }
    throw new IdentityLockedError();
  }

  // A phrase already on this device is this voter, so it is used. The slot is
  // read back by the branch at the top of this function, which reconstructs the
  // voter by deriving from whatever it finds.
  const stored = await readPhraseOnDevice();
  if (stored) return remember(await identityFromPhrase(stored));

  // AND OTHERWISE, NOTHING IS MINTED HERE. This used to generate a phrase,
  // write it to disk and hand back an identity, trusting a modal somewhere to
  // show the words. Every silent mint is a voter who can be locked out by one
  // cleared browser without ever having been given the way back, so there is
  // now exactly one place that mints (`beginNewIdentity`) and it is reached by
  // a screen that does not move on until the words have been copied.
  throw new IdentityNotSetUpError();
}

/**
 * There is no identity yet, and making one is not this function's business.
 *
 * Caught by the identity step, which runs the setup a new voter has to go
 * through. Anywhere else it means something asked for an identity before that
 * screen had been past, which is a routing mistake and should look like one.
 */
export class IdentityNotSetUpError extends Error {
  constructor() {
    super("This voter has no identity yet: finish the setup at /voter/identity");
    this.name = "IdentityNotSetUpError";
  }
}

/** The voter has an identity, but this device could not unlock it. */
export class IdentityLockedError extends Error {
  constructor() {
    super(
      "Your voting identity is locked on this device. Approve the passkey prompt, " +
        "or use one of your registered devices to unlock it.",
    );
    this.name = "IdentityLockedError";
  }
}

type VaultOutcome =
  /** Unlocked, or freshly minted for a first-time voter. */
  | { status: "resolved"; identity: Identity }
  /** A vault exists but no passkey here opened it. Must NOT mint a new one. */
  | { status: "locked" }
  /** Nobody by this name yet. The setup screen makes one; this does not. */
  | { status: "new" }
  /** No session, no vault, or no PRF support: the caller may fall back. */
  | { status: "unavailable" };

/** The backup opened, but the identity inside is not the one it claims. */
export class BackupMismatchError extends Error {
  constructor() {
    super(
      "This backup opened, but the identity inside does not match the commitment " +
        "it claims. It may belong to another voter.",
    );
    this.name = "BackupMismatchError";
  }
}

async function resolveIdentityFromVault(): Promise<VaultOutcome> {
  let vault: VaultState | null;
  try {
    vault = await fetchVault();
  } catch (error: unknown) {
    console.warn("Identity vault unreachable:", error);
    return { status: "unavailable" };
  }
  // Not signed in yet: no session cookie, so there is nothing to unlock.
  if (!vault) return { status: "unavailable" };

  if (vault.entries.length > 0) {
    const known = vault.entries.map(e => e.credentialId);
    const assertion = await assertPrf(known);
    if (!assertion) return { status: "locked" };

    // Prefer the blob for the credential that answered; fall back to trying the
    // rest, which covers a credential id that changed representation.
    const ordered = [
      ...vault.entries.filter(e => e.credentialId === assertion.credentialId),
      ...vault.entries.filter(e => e.credentialId !== assertion.credentialId),
    ];
    for (const entry of ordered) {
      const secret = await unwrapSecret(assertion.secret, entry.blob);
      if (secret) {
        // An assertion answered with the secret, so this device can read the
        // vault and has no further use for a local copy.
        noteReadBack();
        // What the vault holds is the RECOVERY PHRASE, not an exported
        // identity: the identity is a function of it, so the same words rebuild
        // the same voter on a device that has no passkey at all.
        const identity = await identityFromPhrase(secret);
        // A passkey that unlocked the vault but has no entry of its own is a
        // device the voter authenticated from remotely: give it local access.
        // Sealing the same phrase that was just read out of the vault.
        if (!known.includes(assertion.credentialId)) {
          await sealPhraseForPasskey(secret, identity, assertion);
        }
        return { status: "resolved", identity: remember(identity) };
      }
    }

    console.warn("A passkey answered but none of the stored blobs opened with it");
    return { status: "locked" };
  }

  // REGISTERED, WITH NOTHING HERE TO OPEN IT. The vault knows the commitment
  // this voter enrolled with, so an empty entry list does not mean "new": it
  // means no passkey ever held a copy, which is the ordinary state on a device
  // that can create a passkey and never evaluate it.
  //
  // Falling through to mint would hand them a DIFFERENT identity with a
  // different commitment, silently, while the registry still points at the old
  // one. Everything would look fine until an enrolment was refused for reasons
  // that name none of this. The phrase is the only way back, and saying so is
  // what `locked` means.
  if (vault.commitment) return { status: "locked" };

  // FIRST TIME FOR THIS HUMAN, and this function stops here on purpose.
  //
  // It used to mint the phrase, create a passkey, seal, register and announce,
  // all inside one call that some screen had triggered for another reason
  // entirely. The voter met an authenticator dialog they had not asked for and
  // their twelve words arrived afterwards in a modal, as a notification about
  // something already done to them.
  //
  // Setting up an identity is now a place the voter goes, not a side effect:
  // see `beginNewIdentity` and the two steps that follow it.
  return { status: "new" };
}

/**
 * Mints the phrase a new voter's identity is built from, or returns the one
 * this device already holds mid-setup.
 *
 * REUSED RATHER THAN REMINTED, because somebody who copied twelve words onto
 * paper and then closed the tab must find the same twelve words when they come
 * back. Minting afresh would quietly turn what they wrote down into a stranger's
 * identity.
 *
 * Nothing is registered here. The chain hears about this voter when they finish
 * the setup, with or without a passkey, so an abandoned screen leaves nothing
 * behind but a phrase on one device.
 */
export async function beginNewIdentity(): Promise<{ phrase: string; identity: Identity }> {
  const existing = await readPhraseOnDevice();
  const phrase = existing ?? generateRecoveryPhrase();
  if (!existing) await keepPhraseOnDevice(phrase);
  return { phrase, identity: await identityFromPhrase(phrase) };
}

/**
 * What finishing the setup left behind.
 *
 *   sealed  - a passkey holds the phrase; the local copy is gone.
 *   stored  - the phrase is on this device in the clear, which is the
 *             documented fallback and the only way in on a platform that
 *             cannot evaluate PRF.
 */
export type NewIdentityResult =
  | { kept: "sealed" }
  | { kept: "stored"; vaultWriteFailed?: true };

/**
 * Finishes the setup WITH a passkey: seals the phrase under it and registers.
 *
 * Throws `PasskeyCancelledError` when the prompt is dismissed, because that is
 * a decision and not a limit: the screen keeps them where they are and offers
 * the attempt again. Returns `kept: "stored"` when the authenticator genuinely
 * cannot hold a secret, which is a different answer and gets different words.
 */
export async function completeWithPasskey(
  phrase: string,
  identity: Identity,
): Promise<NewIdentityResult> {
  const assertion = await enrollPrfPasskey("voter");
  if (!assertion) {
    // Created a credential and could not read it back, or could not create a
    // PRF-capable one at all. Either way nothing can be sealed under it, so the
    // phrase stays and the voter is told which of the two happened.
    await ensureRegistered(identity);
    return { kept: "stored" };
  }

  // The passkey working and the chain accepting the blob are two events, and
  // only the first is about the passkey. A registrar out of gas must not read
  // as a broken credential, and must not cost the voter their setup.
  try {
    await sealPhraseForPasskey(phrase, identity, assertion);
    noteSealed(phrase);
    await ensureRegistered(identity);
    return { kept: "sealed" };
  } catch (error: unknown) {
    console.error("The passkey worked and the vault write did not:", error);
    keepPhraseOnDevice(phrase);
    noteVaultWritePending(assertion.credentialId);
    await ensureRegistered(identity);
    return { kept: "stored", vaultWriteFailed: true };
  }
}

/**
 * Finishes the setup WITHOUT one, which is a real answer and not a failure.
 *
 * The registration still happens. Being on the registry is what lets a voter
 * enrol at all, and it does not depend on holding a passkey: welding the two
 * together left anyone whose authenticator refused off the chain entirely, to
 * find out weeks later when an enrolment was rejected.
 */
export async function completeWithoutPasskey(
  phrase: string,
  identity: Identity,
): Promise<NewIdentityResult> {
  keepPhraseOnDevice(phrase);
  remember(identity);
  await ensureRegistered(identity);
  return { kept: "stored" };
}

/**
 * A working passkey whose sealed copy never reached the chain.
 *
 * Kept on the device rather than in memory because the retry is not in this
 * page's life: the voter is shown their phrase, carries on, and comes back to
 * their profile later. Cleared as soon as a vault entry for this voter exists.
 */
const VAULT_PENDING_KEY = "votain_vault_entry_pending";

function noteVaultWritePending(credentialId: string): void {
  localStorage.setItem(VAULT_PENDING_KEY, credentialId);
}

export function vaultWritePending(): string | null {
  return localStorage.getItem(VAULT_PENDING_KEY);
}

export function clearVaultWritePending(): void {
  localStorage.removeItem(VAULT_PENDING_KEY);
}

/**
 * Takes a typed phrase as this device's identity.
 *
 * The identity is a pure function of the words, so nothing is fetched and
 * nothing has to agree: whoever types the right phrase reconstructs the same
 * voter, which is what makes this work where no passkey can.
 *
 * The phrase is kept locally and, where an authenticator can hold it, sealed
 * under a passkey as well, so this device stops asking after the first time.
 * Sealing is best effort: failing to add the convenience must not fail the
 * recovery it was meant to make easier.
 */
/**
 * Where a phrase ended up on this device, which is not a detail.
 *
 *   sealed  - under a passkey; nothing readable at rest.
 *   stored  - in the clear, because this platform cannot seal it. The
 *             documented fallback: without it, Windows has no way in at all.
 *   session - nowhere. The person was asked and said no, so this browser keeps
 *             the identity in memory and forgets it on reload.
 */
export type PhraseAdoption = "sealed" | "stored" | "session";

/**
 * Takes on an identity from its twelve words, and reports what it kept.
 *
 * THE ORDER MATTERS AND IT USED TO BE WRONG. The phrase was written to
 * localStorage first, unconditionally, and only then was a passkey offered. So
 * dismissing that prompt left the words in the clear on disk while the screen
 * showed a green "restored": the one outcome nobody would have chosen, reached
 * by the one gesture that says they did not want it.
 *
 * Declining is now its own answer. Nothing is written, the identity lives for
 * this session, and the caller is told so it can say it out loud. Somebody who
 * dismisses that prompt on a shared computer means exactly what they did.
 *
 * A platform that CANNOT seal is a different case and keeps the old behaviour,
 * because there the fallback is the only way back in.
 */
/**
 * Raised when the words are well formed and belong to no registered voter.
 *
 * Its own type because the screen has to tell it apart from a network
 * failure: one means "check what you typed" and the other means "try again
 * in a moment", and showing the wrong one sends somebody looking for a
 * mistake they did not make.
 */
export class PhraseNotRegisteredError extends Error {
  constructor() {
    super("That phrase does not belong to a registered identity");
    this.name = "PhraseNotRegisteredError";
  }
}

/**
 * Whether the chain knows the identity these words rebuild.
 *
 * WHAT WAS MISSING. `isValidPhrase` checks the SHAPE of a phrase: twelve
 * words, all from the list. Nothing checked whether the phrase was the right
 * one. Twelve words picked at random off that list derive a perfectly valid
 * Semaphore identity, so a single mistyped word was adopted in silence and
 * the voter was handed a brand new identity enrolled in nothing. Every
 * election then said they were not a member, with no explanation and no way
 * back: the real identity was still recoverable, but the app had already
 * stopped asking for it.
 *
 * WHAT THIS CAN AND CANNOT SETTLE. The registry answers "is this commitment a
 * verified member", and deliberately does not map a person to a commitment,
 * because that mapping is what the anonymity rests on. So this catches the
 * mistake, which is the case that actually happens, and cannot catch somebody
 * typing another person's phrase, which is not a check that belongs on a
 * client: whoever holds the words holds the identity, and that is what the
 * words are.
 *
 * `unknown` when there is no chain to ask or the read fails. Recovery must
 * not depend on a registry lookup succeeding: a voter with the right words
 * and a bad connection would be locked out of their own identity by a check
 * meant to protect them.
 */
async function registrationOfPhrase(
  identity: Identity,
): Promise<"registered" | "unregistered" | "unknown"> {
  if (!isChainConfigured()) return "unknown";
  try {
    const registry = getRegistry();
    const known = (await registry.verifiedMembers(identity.commitment)) as boolean;
    return known ? "registered" : "unregistered";
  } catch (error: unknown) {
    console.warn("Could not ask the registry about this phrase:", error);
    return "unknown";
  }
}

/**
 * Take on the identity a phrase rebuilds, and decide nothing else.
 *
 * IT USED TO SUMMON A PASSKEY DIALOG on its own, inside this call. Typing the
 * last word of a recovery phrase produced an authenticator prompt with no
 * warning, no explanation of what it was for, and no way to see it coming,
 * which is the exact pattern the sign-in step was rebuilt to avoid and which
 * the identity step already says out loud: nothing here asks for a
 * fingerprint without saying why first. Where the phrase LIVES is now a
 * second, announced step, the same two steps a new voter walks through.
 *
 * NOTHING IS WRITTEN TO DISK HERE, and that is deliberate rather than
 * incidental. Persisting the words before the passkey question is answered is
 * the older bug this flow already had once: dismissing the prompt left them
 * in the clear on a device the voter was being careful about, under a screen
 * that said "restored". The commitment is remembered so the session works;
 * the words stay in the caller's hands until someone chooses where they go.
 */
export async function adoptRecoveryPhrase(
  phrase: string,
): Promise<{ identity: Identity }> {
  const identity = await identityFromPhrase(phrase);

  // Before anything is remembered. Adopting first and checking after would
  // leave the wrong identity on this device.
  if ((await registrationOfPhrase(identity)) === "unregistered") {
    throw new PhraseNotRegisteredError();
  }

  return { identity: remember(identity) };
}

/**
 * Seal a recovered phrase under a passkey on this device.
 *
 * `completeWithPasskey` without the registration: a voter recovering is
 * already in the registry, which is how their phrase got past
 * `adoptRecoveryPhrase` in the first place, and asking the registrar to add
 * them again would be a write that exists only to be rejected.
 */
export async function sealRecoveredPhrase(phrase: string, identity: Identity): Promise<PhraseAdoption> {
  const normalized = normalizePhrase(phrase);
  // Already known to be unable to read one back: asking again spends a
  // fingerprint to be told what we know.
  if (prfReadbackFailed()) {
    keepPhraseOnDevice(normalized);
    return "stored";
  }

  const assertion = await enrollPrfPasskey("voter");
  if (!assertion) {
    // A credential that cannot do PRF, or one that could not be read back.
    // Nothing can be sealed under it, so the words stay on the device.
    keepPhraseOnDevice(normalized);
    return "stored";
  }

  try {
    await sealPhraseForPasskey(normalized, identity, assertion);
    noteSealed(normalized);
    return "sealed";
  } catch (error: unknown) {
    // The passkey working and the vault write succeeding are two events, and
    // only the first was about the passkey.
    console.error("The passkey worked and the vault write did not:", error);
    keepPhraseOnDevice(normalized);
    return "stored";
  }
}

/** Keep a recovered phrase on this device, in the clear, having been asked. */
export async function keepRecoveredPhraseOnDevice(phrase: string): Promise<PhraseAdoption> {
  await keepPhraseOnDevice(normalizePhrase(phrase));
  return "stored";
}


/**
 * The voter's recovery phrase, read from wherever this device keeps it.
 *
 * Always available to the voter by design: that is the entire point of the
 * phrase being the root. It comes from localStorage where no passkey could hold
 * it, and otherwise from the vault, which costs one authenticator prompt.
 *
 * Returns null when this device cannot reach it, which is a device that could
 * not vote either, so the caller is already in the locked path.
 */
export async function revealRecoveryPhrase(): Promise<string | null> {
  const local = await readPhraseOnDevice();
  if (local) return local;

  const vault = await fetchVault().catch(() => null);
  if (!vault || vault.entries.length === 0) return null;

  const assertion = await assertPrf(vault.entries.map(e => e.credentialId));
  if (!assertion) return null;

  for (const entry of vault.entries) {
    const phrase = await unwrapSecret(assertion.secret, entry.blob);
    if (phrase) return phrase;
  }
  return null;
}

/** Seals the recovery PHRASE under one passkey and publishes the entry. */
async function sealPhraseForPasskey(
  phrase: string,
  identity: Identity,
  assertion: PrfAssertion,
): Promise<void> {
  const blob = await wrapSecret(assertion.secret, phrase);
  await putVaultEntry({
    credentialId: assertion.credentialId,
    blob,
    commitment: identity.commitment.toString(),
  });
  // A write got through, so whatever was owed is paid. Every path that seals
  // comes past here, which is why the clearing lives here and not at each of
  // them.
  clearVaultWritePending();
}

/**
 * Recovery: mint a brand new PHRASE on this device and rebind the voter to it.
 *
 * The last resort, for a voter who has lost the phrase AND every passkey that
 * could open it. Anyone who still has the words wants `adoptRecoveryPhrase`
 * instead, which costs nothing and keeps every enrolment; this rotates the
 * on-chain commitment and cannot.
 *
 * The caller must supply a fresh World ID proof, because this rebinds the
 * identity the voter votes with and a stolen session must not be enough to take
 * someone's identity over.
 *
 * The voter comes back able to join elections they had not enrolled in, and
 * permanently unable to re-enter the ones they had. The chain cannot tell
 * whether they already voted there, so refusing is the only safe answer.
 *
 * What it returns them to is the state a new voter is in: a phrase that is the
 * root, sealed under a passkey. Minting a bare identity here, as this used to,
 * left them with no way back at all the second time.
 *
 * A passkey is REQUIRED on this path alone, and it is the contract that
 * requires it: `PlatformRegistry.resetVault` rejects an empty vault entry, so
 * the rotation has nothing to write without one. It costs less than it sounds
 * like, because CREATING a credential is the half that works everywhere; it is
 * evaluating it later that some platforms refuse, and the phrase covers that.
 */
export async function rotateToNewIdentity(
  worldIdProof: unknown,
): Promise<{ phrase: string; identity: Identity }> {
  // ALWAYS A FRESH PHRASE, and deliberately NOT `beginNewIdentity`, which
  // reuses whatever is already on the device. Reuse is right for a first-time
  // voter, who must find the words they copied; it is wrong here, where the
  // words on this device are the ones being abandoned. Worse, they might not be
  // theirs at all on a shared browser, and rotating onto a commitment whose
  // phrase somebody else holds is the opposite of a recovery.
  const phrase = generateRecoveryPhrase();
  const identity = await identityFromPhrase(phrase);

  // NO PASSKEY HERE, and that is the change. Recovery used to demand one
  // because it called `resetVault`, which the contract refuses to run with an
  // empty entry, so the ONE screen that cannot fall back to the phrase was the
  // one reached by people most likely to be on a borrowed machine or on an
  // authenticator that creates credentials it will not evaluate. The rotation
  // and the sealing are separate events and only the second needs a passkey.
  await recoverIdentity({
    commitment: identity.commitment.toString(),
    worldIdProof,
  });

  // Only adopted locally once the issuer confirmed the rotation, and written
  // rather than left alone: any older phrase in this slot belongs to the
  // identity that was just revoked, and `getOrCreateIdentity` reads this slot
  // first when the mode is "local". Leaving it would hand back the dead voter.
  keepPhraseOnDevice(phrase);
  clearPrfReadback();
  remember(identity);
  return { phrase, identity };
}

/**
 * Registers a NEW passkey on this device for the voter's existing identity, so
 * the device can vote on its own afterwards without reaching for another one.
 * Requires the identity to be unlocked already.
 */
/**
 * Puts this voter's commitment on the chain if it is not there already.
 *
 * Best effort, and deliberately so at its call sites: the voter has their
 * phrase, so a backend that is briefly unreachable must not cost them the
 * identity they just made. The failure heals on the next attempt, because
 * `registerMember` is idempotent for a human already holding this commitment.
 */
export async function ensureRegistered(identity: Identity): Promise<boolean> {
  try {
    await registerCommitment(identity.commitment.toString());
    return true;
  } catch (error: unknown) {
    console.warn("Could not register this identity on chain yet:", error);
    return false;
  }
}

/**
 * Whether this voter's phrase is sitting on this device in the clear.
 *
 * True is not a fault: it is the documented fallback, and on a platform that
 * cannot evaluate PRF on an assertion it is the only way back in. It is also
 * not something to leave unsaid, which is what it was: a new voter was handed
 * their words, the seal was attempted as a side effect nobody announced, and
 * when it did not happen they were never told the copy was unprotected.
 */
export function phraseIsUnprotected(): boolean {
  // Still "unprotected" when it is sealed under this device's key, and that
  // is not a slip. The seal answers somebody carrying the storage away; it
  // cannot answer somebody holding the device, because the key is on it. Only
  // a passkey moves the secret off this machine, so only a passkey clears
  // this flag and stops the screen offering to link one.
  return localStorage.getItem(IDENTITY_MODE_KEY) === "local" && hasPhraseOnDevice();
}

export async function enrollThisDevice(): Promise<{
  credentialId: string;
  /** True when the authenticator already held a registered passkey. */
  alreadyRegistered: boolean;
}> {
  const identity = await getOrCreateIdentity();

  // WHAT THE AUTHENTICATOR IS TOLD NOT TO DO, rather than what this function
  // refuses to try. Passing the registered ids as `excludeCredentials` is how a
  // duplicate is prevented: the authenticator knows what it holds, refuses with
  // InvalidStateError, and the browser still offers everything else, a phone
  // over the QR transport included.
  //
  // This used to return early when the id cached HERE was already registered,
  // which answered a different question. It meant "this browser's own passkey
  // is in the list" and was read as "there is nothing left to add", so pressing
  // the button said "this device already holds one of your passkeys" and
  // stopped, and a voter could never link a SECOND authenticator: not their
  // phone, not a second laptop, not a security key. Linking another is the
  // whole point of the list.
  const vault = await fetchVault();
  const known = vault?.entries.map(e => e.credentialId) ?? [];

  try {
    // Nothing cached to compare against, so hand the ids to the authenticator:
    // it knows what it holds and refuses with InvalidStateError.
    const assertion = await enrollPrfPasskey("voter", known);
    if (!assertion) {
      throw new Error("This device cannot create a PRF-capable passkey");
    }
    // What gets sealed is the phrase, so this passkey reconstructs the same
    // identity rather than holding a copy of one.
    //
    // AND THIS IS WHERE ADDING A SECOND PASSKEY CAN STILL FAIL, on a machine
    // whose own authenticator cannot evaluate PRF. The phrase lives either in
    // localStorage or sealed under a credential ALREADY in the vault, and
    // reading the sealed copy means asserting one of those, not the one that
    // was just created somewhere else. Said out loud, because otherwise it
    // arrives as a locked identity with no visible cause right after a
    // successful-looking enrolment on the phone.
    const phrase = await revealRecoveryPhrase();
    if (!phrase) {
      console.error(
        "A passkey was created but the phrase could not be read back to seal " +
          "under it: not on this device, and none of the credentials already " +
          "in the vault could be asserted here.",
      );
      throw new IdentityLockedError();
    }
    await sealPhraseForPasskey(phrase, identity, assertion);
    /**
     * AND THE BOOKKEEPING, which is what was missing.
     *
     * This is the function the "add a passkey" button calls, and it sealed the
     * phrase into the vault and then left the device exactly as it found it:
     * still in `local` mode, still holding the twelve words. So a voter linked
     * a passkey, was told it worked, and their phrase stayed on the machine
     * with nothing asking it to leave. It also meant the profile kept offering
     * to protect a phrase that was already protected, since that offer reads
     * the same flag.
     *
     * `noteSealed` is the one place that decides what a device may stop
     * holding: it marks the identity as living behind a passkey, and drops the
     * local copy only once this device has PROVEN it can read a sealed one
     * back, which `enrollPrfPasskey` establishes before it returns.
     */
    await noteSealed(phrase);
    return { credentialId: assertion.credentialId, alreadyRegistered: false };
  } catch (error: unknown) {
    if (!(error instanceof PasskeyAlreadyRegisteredError)) throw error;

    // The refusal proves a registered passkey is here, but not WHICH one, and
    // this browser has no cached id to show. Assert it: that both identifies the
    // credential and caches its id, so the profile marks the device as this one
    // instead of going on offering to add it.
    const existing = await assertPrf(known);
    if (!existing) throw error;
    // THE SAME BOOKKEEPING, and it is earned here too. The refusal says this
    // authenticator already holds a credential from the vault, and the
    // assertion just opened it: the phrase is therefore reachable through a
    // passkey from this machine, whether or not this browser was the one that
    // sealed it, so the copy at rest has nothing left to protect against.
    const local = await readPhraseOnDevice();
    if (local) await noteSealed(local);
    return { credentialId: existing.credentialId, alreadyRegistered: true };
  }
}

/**
 * The voter's PUBLIC identity commitment for read-only checks (enrolled / voted),
 * available without a passkey prompt once the identity has been derived at least
 * once on this device. Null if it never has.
 */
export function getStoredCommitment(): bigint | null {
  if (cachedIdentity) return cachedIdentity.commitment;
  const c = localStorage.getItem(IDENTITY_COMMITMENT_KEY);
  return c ? BigInt(c) : null;
}

// Per-election vote nullifier (PUBLIC, emitted in VoteCast). Remembered on this
// device after voting so "already voted" shows without a passkey prompt; the
// truth is still verified on-chain via nullifierNonces.
const VOTE_NULLIFIER_PREFIX = "votain_vote_";

export function rememberVote(electionAddress: string, nullifier: bigint): void {
  localStorage.setItem(VOTE_NULLIFIER_PREFIX + electionAddress.toLowerCase(), nullifier.toString());
}

export function getStoredVoteNullifier(electionAddress: string): bigint | null {
  const v = localStorage.getItem(VOTE_NULLIFIER_PREFIX + electionAddress.toLowerCase());
  return v ? BigInt(v) : null;
}

/**
 * Synchronous best-effort read for informational UI (enrolled status, history).
 *
 * The in-memory identity or nothing. It used to fall back to localStorage with
 * `Identity.import`, which now reads a RECOVERY PHRASE as though it were an
 * exported key: that returns a perfectly valid identity belonging to nobody, and
 * its nullifiers match no vote the voter ever cast, so the history would be
 * silently empty rather than visibly unavailable. Deriving properly is
 * asynchronous (HKDF), so it cannot happen here.
 *
 * Returning null until `getOrCreateIdentity()` has run is the honest answer, and
 * every caller already treats it as "not yet".
 */
export function getStoredIdentity(): Identity | null {
  return cachedIdentity;
}

/** True when the voter's identity is available without a fresh passkey prompt. */
export function isIdentityLoaded(): boolean {
  return getStoredIdentity() !== null;
}

export function clearIdentity(): void {
  // The per-election identities are derived from the secret being cleared, and
  // their commitments are cached for badge-drawing. Both go with it.
  forgetElectionIdentities();
  cachedIdentity = null;
  void clearPhraseOnDevice();
  localStorage.removeItem(IDENTITY_MODE_KEY);
  clearPrfReadback();
  localStorage.removeItem(IDENTITY_COMMITMENT_KEY);
  // Drop this device's per-election vote records too.
  for (const k of Object.keys(localStorage)) {
    if (k.startsWith(VOTE_NULLIFIER_PREFIX)) localStorage.removeItem(k);
  }
  if (hasPrfCredential()) clearPrfCredential();
}

// ────────────────────────────────────────────────
// Group reconstruction
// ────────────────────────────────────────────────

/** Rebuilds the election's member group from MemberEnrolled events. */
export async function fetchElectionGroup(electionAddress: string): Promise<Group> {
  const election = getElection(electionAddress);
  const events = await queryLogsFrom(election, election.filters.MemberEnrolled());
  // Events arrive ordered by (blockNumber, logIndex) == insertion order.
  const members = events.map(e =>
    BigInt((e as unknown as { args: { identityCommitment: bigint } }).args.identityCommitment),
  );
  return new Group(members);
}

// ────────────────────────────────────────────────
// Vote proof
// ────────────────────────────────────────────────

/** keccak256(ciphertext ‖ nonce): must mirror ElectionV4.castVote exactly. */
export function voteMessage(voteCiphertext: string, nonce: bigint): bigint {
  return BigInt(solidityPackedKeccak256(["bytes", "uint256"], [voteCiphertext, nonce]));
}

/** Semaphore's hash-to-field (keccak256 of a uint256, truncated to the field). */
function hashToField(value: bigint): bigint {
  return BigInt(keccak256(zeroPadValue(toBeHex(value), 32))) >> 8n;
}

/**
 * Computes the Semaphore nullifier for a voter+scope WITHOUT generating a proof.
 * nullifier = Poseidon2(hash(scope), identity.secretScalar). Lets us read the
 * on-chain nonce before doing the expensive proof generation.
 */
export function computeNullifier(identity: Identity, scope: bigint): bigint {
  return poseidon2([hashToField(scope), identity.secretScalar]);
}

export interface VoteProof {
  merkleTreeDepth: bigint;
  merkleTreeRoot: bigint;
  nullifier: bigint;
  pA: [bigint, bigint];
  pB: [[bigint, bigint], [bigint, bigint]];
  pC: [bigint, bigint];
}

/**
 * Generates the Semaphore membership proof for a vote.
 * @param voteCiphertext 0x-hex Paillier ciphertext of the encoded ballot.
 * @param nonce Current nullifierNonce for this voter (re-vote support).
 * @param scope Election scope (external nullifier).
 */
export async function generateVoteProof(
  identity: Identity,
  group: Group,
  voteCiphertext: string,
  nonce: bigint,
  scope: bigint,
): Promise<VoteProof> {
  const message = voteMessage(voteCiphertext, nonce);
  const proof: SemaphoreProof = await generateProof(identity, group, message, scope);

  // points order (packGroth16Proof) is already Solidity calldata order.
  const p = proof.points.map(BigInt);
  return {
    merkleTreeDepth: BigInt(proof.merkleTreeDepth),
    merkleTreeRoot: BigInt(proof.merkleTreeRoot),
    nullifier: BigInt(proof.nullifier),
    pA: [p[0], p[1]],
    pB: [
      [p[2], p[3]],
      [p[4], p[5]],
    ],
    pC: [p[6], p[7]],
  };
}
