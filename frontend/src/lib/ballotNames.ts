/**
 * When two ballot options count as the same option.
 *
 * A voter picks by reading. Two entries that render identically are one choice
 * presented twice, and the voter who picks the wrong one has no way of knowing
 * they did: the vote is cast by POSITION, so the tally stays correct while the
 * intent behind it does not. That is the failure this exists to prevent, and it
 * is why the comparison is about what reaches the screen rather than about what
 * was typed.
 *
 * Three normalisations, each for something that renders the same and compares
 * differently:
 *
 *  - **Case.** Nobody tells two candidates apart by the case of a letter.
 *  - **Unicode form.** "José" with a precomposed é and "José" with a combining
 *    accent are different strings and the same pixels.
 *  - **Runs of whitespace.** HTML collapses them, so "Ana  Lopez" and
 *    "Ana Lopez" are one line on the ballot and two strings here.
 *
 * What it deliberately does NOT do is strip accents. "Jose" and "José" are
 * different names, and an organizer is entitled to put both on a ballot.
 */

/** The form two names are compared in. Never displayed. */
export function ballotKey(name: string): string {
  return name.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
}

/** Whether any two of these names would reach a voter as the same option. */
export function hasDuplicateNames(names: string[]): boolean {
  const keys = names.map(ballotKey).filter(key => key.length > 0);
  return new Set(keys).size !== keys.length;
}

/**
 * Every blank-vote label this app can render, in any language.
 *
 * The blank option is appended when an election is READ, not when it is
 * created, so a candidate literally named "Voto en blanco" produces a ballot
 * with that line on it twice and no rule in the wizard ever looked at it. The
 * organizer is only shown their own language, so only their own is refused;
 * the rest is handled on the read side by `withDistinctNames`, which runs in
 * the reader's language and therefore sees the collision that actually happens.
 */
export function collidesWithBlankVote(name: string, blankVoteLabel: string): boolean {
  return ballotKey(name) === ballotKey(blankVoteLabel);
}

/**
 * Makes options that read alike tell themselves apart, by disclosing the one
 * thing that genuinely differs: the position on the ballot the vote is cast by.
 *
 * This is the half of the rule that cannot be bypassed. The wizard's check runs
 * in a browser and an election can be deployed straight to the factory by
 * anyone willing to build the transaction by hand, but nothing puts an election
 * in front of a voter except this read path. A contract-level check is not the
 * alternative: the names live inside a JSON string in `metadataJson`, and
 * parsing that on chain is neither practical nor worth its gas.
 *
 * Untouched when nothing collides, which is every election created through the
 * wizard, so the suffix is a symptom rather than a decoration.
 */
export function withDistinctNames<T extends { name: string }>(options: T[]): T[] {
  const counts = new Map<string, number>();
  for (const option of options) {
    const key = ballotKey(option.name);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  if ([...counts.values()].every(count => count < 2)) return options;

  return options.map((option, index) =>
    (counts.get(ballotKey(option.name)) ?? 0) > 1
      ? { ...option, name: `${option.name} (#${index + 1})` }
      : option,
  );
}
