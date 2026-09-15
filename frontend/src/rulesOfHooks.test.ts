import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * No hook may be called after a conditional return.
 *
 * React counts hooks by call order. One that sits behind an `if (...) return`
 * is called on some renders and not others, so the count changes and React
 * throws "Rendered more hooks than during the previous render", which does not
 * degrade a screen: it takes the whole tree down.
 *
 * The bug this exists for: `ElectionDetail` called `useVoterIdentity(live)`
 * below its loading and not-found returns. The first render was still loading
 * and never reached it, the next one did, and the entire election page died on
 * a white screen. `live` came from a hook above those returns and never needed
 * to be down there at all; the file even carried a comment on `canManage`
 * explaining that very constraint, two dozen lines higher.
 *
 * `react-hooks/rules-of-hooks` is the usual guard and this project has no
 * ESLint: `typescript-eslint` throws on TypeScript 7, which all four packages
 * are on (`frontend/DEVELOPMENT.md`, "No linter"). So the rule is checked here
 * instead of not at all. The check is deliberately narrow, matching body-level
 * `if` blocks that return and body-level hook calls, because a false alarm in a
 * test nobody can silence is worse than the narrow coverage.
 */

const SRC = join(__dirname);

/** A component or hook definition at file level. */
const DEFINITION = /^(?:export\s+)?(?:default\s+)?function\s+([A-Za-z][A-Za-z0-9]*)\s*\(/;
/** A hook call in the function body, at its own indentation. */
const HOOK_CALL = /^ {2}(?:const|let)?\s*.*?\b(use[A-Z][A-Za-z0-9]*)\s*\(/;
/** An `if` at body level, which may guard an early return. */
const GUARD = /^ {2}if\s*\(/;

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return tsxFiles(full);
    return entry.isFile() && entry.name.endsWith('.tsx') && !entry.name.includes('.test.')
      ? [full]
      : [];
  });
}

interface Offence {
  file: string;
  line: number;
  component: string;
  hook: string;
  guard: string;
}

function offences(file: string): Offence[] {
  const lines = readFileSync(file, 'utf8').split('\n');
  const starts = lines.flatMap((l, i) => (DEFINITION.test(l) ? [i] : []));
  const found: Offence[] = [];

  starts.forEach((start, n) => {
    const end = starts[n + 1] ?? lines.length;
    const component = DEFINITION.exec(lines[start])![1];
    let guardedAt: number | null = null;

    for (let i = start; i < end; i++) {
      const line = lines[i];
      if (line.trim().startsWith('//') || line.trim().startsWith('*')) continue;

      if (GUARD.test(line)) {
        // Only a guard if the block it opens actually returns.
        const block = lines.slice(i, i + 12).join('\n');
        if (/^ {4}return\b/m.test(block)) guardedAt = i;
        continue;
      }

      const hook = HOOK_CALL.exec(line);
      if (hook && guardedAt !== null) {
        found.push({
          file,
          line: i + 1,
          component,
          hook: hook[1],
          guard: lines[guardedAt].trim(),
        });
        guardedAt = null; // one report per component is enough to act on
      }
    }
  });

  return found;
}

describe('rules of hooks', () => {
  it('calls no hook after a conditional return', () => {
    const all = tsxFiles(SRC).flatMap(offences);
    const readable = all.map(
      o => `${o.file}:${o.line} ${o.component}() calls ${o.hook} after \`${o.guard}\``,
    );
    expect(readable).toEqual([]);
  });
});
