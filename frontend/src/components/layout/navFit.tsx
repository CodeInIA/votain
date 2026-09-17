import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

/**
 * Whether the navigation fits in the top bar, MEASURED rather than guessed.
 *
 * WHY THERE IS NO BREAKPOINT HERE. The bar holds a different number of links in
 * each role, in thirteen languages, beside a role switch whose labels are words:
 * the organizer's row wants 991px in English and 1077 in Russian, the voter's
 * far less, and a visitor's less again. One width cannot be right for all of
 * them. Picked low, the links are drawn over the role switch and the profile
 * button, and the half that vanishes is the half nobody can scroll to. Picked
 * high, a 1200px window gets a phone's navigation with 400px to spare, which is
 * what the last attempt did.
 *
 * So `TopNav` measures what its own row needs, compares it with the room it
 * has, and reports the answer here. Everything that has to agree with it reads
 * it: the bottom tab bar, which is the other half of the same decision, the
 * footer, and the card of links that stands in for the footer.
 *
 * The default is for the rare tree with no provider above it, and is a guess on
 * the safe side: compact, so nothing can be cut off before the first
 * measurement lands.
 */
interface NavFit {
  /** The links do not fit up top, so the bottom bar carries them. */
  compact: boolean;
  /** `TopNav` reports what it measured. */
  report: (compact: boolean) => void;
}

const NavFitContext = createContext<NavFit>({ compact: true, report: () => {} });

export const useNavFit = (): NavFit => useContext(NavFitContext);

export function NavFitProvider({ children }: { children: ReactNode }) {
  /**
   * The first paint, before anything has been measured.
   *
   * A width no bar has ever needed more than, so a wide window starts with its
   * links and a narrow one starts without them, and the layout effect that runs
   * before paint corrects whichever was wrong. Getting this wrong costs a
   * flicker, never a broken bar.
   */
  const [compact, setCompact] = useState(
    () => typeof window === 'undefined' || window.innerWidth < 1100,
  );

  const report = useCallback((next: boolean) => {
    // Identity is compared before storing: this is called on every resize
    // frame, and the answer changes twice in the life of most pages.
    setCompact(prev => (prev === next ? prev : next));
  }, []);

  return (
    <NavFitContext.Provider value={useMemo(() => ({ compact, report }), [compact, report])}>
      {children}
    </NavFitContext.Provider>
  );
}
