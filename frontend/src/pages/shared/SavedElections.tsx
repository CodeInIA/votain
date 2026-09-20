import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Bookmark, Compass, Undo2 } from 'lucide-react';
import { PageLayout } from '../../components/layout/PageLayout';
import { ElectionCard } from '../../components/ui/ElectionCard';
import { ElectionFilters } from '../../components/ui/ElectionFilters';
import { Spinner } from '../../components/ui/Spinner';
import { LoadMore } from '../../components/ui/LoadMore';
import { ListError } from '../../components/ui/ListError';
import { Button } from '../../components/ui/Button';
import { useElectionPages } from '../../hooks/useElectionPages';
import { usePageLimit } from '../../hooks/usePageLimit';
import { useElectionFilterParams } from '../../hooks/useElectionFilterParams';
import { useSavedElections } from '../../hooks/useSavedElections';
import { matchesQuery } from '../../lib/electionFilter';
import { sortElections } from '../../lib/electionSort';
import { syncSavedElections, type SavedRole } from '../../lib/savedElections';
import { roleAccent } from '../../lib/activeRole';
import { cn } from '../../lib/utils';

/**
 * The elections this reader kept, whichever role they are wearing.
 *
 * WHY IT IS A PAGE AND NOT A FILTER, which it was twice: a chip in the
 * participation band, then a button in the toolbar. A saved list is not a
 * narrowing of the list you are looking at, it is a different list. The code
 * said so before the interface did, because "saved" resolves a different set
 * of ADDRESSES rather than filtering the ones in hand.
 *
 * ONE PAGE, TWO ROUTES. `/voter/saved` and `/organizer/saved` differ in which
 * list they read and which navigation they wear, and in nothing else. The two
 * lists are separate on purpose: the same human saves different things as
 * somebody taking part and as somebody running elections.
 *
 * WHY THE STATE FILTERS AND NOTHING ELSE. The panel's other bands are for
 * CHOOSING an election, and Discover is where choosing happens. What a reader
 * asks of a list they curated themselves is where each one stands now.
 *
 * AN ELECTION CAN BE HERE AND IN "MY ELECTIONS" AT ONCE, and that is not a
 * duplicate: the two answer different questions, "what am I taking part in"
 * and "what did I keep", and being enrolled in something you also saved is the
 * ordinary case.
 */
export default function SavedElections({ role }: { role: SavedRole }) {
  const { t } = useTranslation();
  const { isSaved, ids, toggle } = useSavedElections(role);

  /**
   * Everything this visit has ever held, so unsaving cannot take a row away.
   *
   * THE PROBLEM IT SOLVES. The list keeps what `isSaved` still says yes to, so
   * pressing the bookmark on a card here deleted the card: the one screen where
   * the mistake costs something is the one screen that hides the evidence, and
   * somebody who missed is left with nothing to aim at. Removing stays instant,
   * which it should be — a star that waits is a star nobody presses twice — and
   * the row stays put, struck through, with the way back on it.
   *
   * IT COSTS NOTHING TO CHANGE YOUR MIND. `toggleSaved` writes locally and
   * schedules the push four seconds out, coalesced, so undoing inside this
   * screen collapses into a write that says what the chain already said.
   *
   * A ref, accumulated during render: a set that grows is not a re-render, and
   * asking for one would only repaint the list to say what it already shows.
   * It is per visit on purpose. Leaving and coming back is the moment a removal
   * is meant to be final, and the list should be the truth again by then.
   */
  const held = useRef<Set<string>>(new Set());
  for (const id of ids) held.current.add(id.toLowerCase());
  const [filters, setFilters] = useElectionFilterParams();
  const [filtersOpen, setFiltersOpen] = useState(false);

  const { all: saved, loading, error, refresh } = useElectionPages({
    scope: 'saved',
    savedRole: role,
    hydrateAll: true,
    keep: e => isSaved(e.id) || held.current.has(e.id.toLowerCase()),
  });

  /**
   * Bring the list here from wherever else it was changed, as the voter's own
   * screen does. It needs an unlocked identity and says nothing without one,
   * so opening a list never summons an authenticator.
   */
  useEffect(() => {
    void syncSavedElections().then(() => refresh());
    // Once per visit: `refresh` is stable, and re-running on every render
    // would turn a list into a poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const byPhase = saved.filter(e => !filters.phase || e.phase === filters.phase);
  const needle = filters.query.trim().toLowerCase();
  const filtered = sortElections(byPhase.filter(e => matchesQuery(e, needle)), filters.sort);
  const { visible, hasMore, loadMore } = usePageLimit(
    filtered,
    undefined,
    `${filters.phase ?? ''}${filters.query}${filters.sort}`,
  );

  return (
    <PageLayout role={role} showNav>
      <div className="max-w-3xl mx-auto pt-6 pb-24">
        <div className="mb-6">
          <h1 className="text-2xl font-black tracking-tight text-white flex items-start gap-2">
            <Bookmark className={`w-5 h-5 shrink-0 mt-1.5 ${roleAccent(role)}`} />
            {t('saved.title')}
          </h1>
          <p className="text-xs text-on-surface-meta mt-0.5">
            {ids.length} {t('saved.count')}
          </p>
        </div>

        {/* Nothing saved is the one case that stays bare: the screen is already
            saying there is nothing here, and a search box over it is furniture. */}
        {ids.length > 0 && (
          <div className="mb-4">
            <ElectionFilters
              value={filters}
              onChange={setFilters}
              open={filtersOpen}
              onToggleOpen={() => setFiltersOpen(open => !open)}
              searchPlaceholder={t('saved.search_placeholder')}
              groups={['status']}
            />
          </div>
        )}

        {/* NOTHING SAVED IS NOT SOMETHING TO WAIT FOR. `ids` is read straight
            out of this device's own storage, synchronously, so an empty list is
            an answer and not an unknown: there is no address to hydrate and
            nothing is in flight. The hook cannot see that, because it derives
            `loading` from "no elections yet and not finished", and the saved
            scope reaches "finished" one effect later than it reaches "known".

            Measured on an empty list, that gap put a spinner exactly where the
            bookmark was about to be, three times, for about ten milliseconds
            each: not one wait but a flicker. A device that syncs new addresses
            down from the chain still shows them the moment they arrive; what it
            no longer does is stall on the way to saying "nothing here". */}
        {loading && ids.length > 0 ? (
          <div className="flex justify-center py-20"><Spinner /></div>
        ) : error ? (
          <ListError onRetry={() => void refresh()} />
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <span className="text-4xl mb-3">🔖</span>
            {/* Two ways to be empty, and they need different sentences: hidden
                by a filter is not the same as never saved. */}
            {ids.length > 0 ? (
              <>
                <p className="text-on-surface-variant text-sm">{t('discover.empty_title')}</p>
                <p className="text-on-surface-meta text-xs mt-1">{t('discover.empty_desc')}</p>
              </>
            ) : (
              <>
                <p className="text-on-surface-variant text-sm">{t('saved.empty')}</p>
                <Link to="/discover">
                  <Button variant="ghost" className="mt-4 gap-2 rounded-2xl h-11">
                    <Compass className="w-4 h-4" />
                    {t('nav.discover')}
                  </Button>
                </Link>
              </>
            )}
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-3">
              {/* A VOTER SEES THEIR OWN STANDING, an organizer does not.
                  Saved elections belong to other people, so for an organizer
                  the voter's buttons would offer something they cannot do,
                  while a voter may well be enrolled in what they saved and
                  should see the same badges as anywhere else. */}
              {/* A REMOVED ROW SHRINKS TO A LINE, it does not sit there at full
                  height. Holding the whole card open kept the list from moving
                  at all, which was more than the problem asked for: what was
                  reported is losing sight of the election, and a named line
                  keeps it in sight. The card underneath it answers nothing a
                  reader deciding whether they missed the bookmark: the phase,
                  the counters and the countdown are not what tells them WHICH
                  one they just removed. Its name is.

                  It matters most in the case this list is really for. Tidying
                  up is removing four or five in a row, and four or five dead
                  full-height cards push everything that still matters off the
                  screen. Four or five lines do not.

                  Two rows animating in opposition, the same `0fr`/`1fr` the
                  hint panel uses: the card folds away while the line unfolds,
                  so the height between them is continuous and what is below
                  follows it up instead of jumping.

                  `inert` ON THE FOLDED HALF, and it is not decoration. Both
                  halves stay in the document so the fold has something to
                  measure, and `overflow-hidden` only stops them being SEEN: the
                  card's links and the undo button would both keep their place
                  in the tab order and their voice in the accessibility tree,
                  which is how a keyboard lands on a control nobody can see. */}
              {visible.map(e => {
                const quitada = !isSaved(e.id);
                return (
                  <div key={e.id}>
                    <div
                      className={cn(
                        'grid transition-[grid-template-rows] duration-200 ease-out',
                        quitada ? 'grid-rows-[0fr]' : 'grid-rows-[1fr]',
                      )}
                    >
                      <div className="min-h-0 overflow-hidden" inert={quitada || undefined}>
                        <ElectionCard election={e} view={role === 'voter' ? 'voter' : 'public'} />
                      </div>
                    </div>

                    <div
                      className={cn(
                        'grid transition-[grid-template-rows] duration-200 ease-out',
                        quitada ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
                      )}
                    >
                      <div className="min-h-0 overflow-hidden" inert={!quitada || undefined}>
                        <div className="flex items-center gap-3 rounded-2xl border border-outline-variant/20 bg-surface-lowest/60 px-4 py-2.5">
                          {/* The name, which is the only thing that answers
                              "was that the one I meant?". */}
                          <span className="min-w-0 flex-1 truncate text-sm text-on-surface-variant">
                            {e.title}
                          </span>
                          <span className="hidden shrink-0 text-xs text-on-surface-meta sm:inline">
                            {t('saved.removed')}
                          </span>
                          <Button
                            variant="ghost"
                            className="h-8 shrink-0 gap-1.5 rounded-full px-3 text-xs"
                            onClick={() => toggle(e.id)}
                          >
                            <Undo2 className="w-3.5 h-3.5" />
                            {t('saved.undo')}
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <LoadMore hasMore={hasMore} loading={false} onClick={loadMore} />
          </>
        )}
      </div>
    </PageLayout>
  );
}
