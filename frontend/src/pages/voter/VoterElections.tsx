import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bell, KeyRound } from 'lucide-react';
import { PageLayout } from '../../components/layout/PageLayout';
import { ElectionCard } from '../../components/ui/ElectionCard';
import { endsSoon } from '../../lib/phase';
import { Spinner } from '../../components/ui/Spinner';
import { LoadMore } from '../../components/ui/LoadMore';
import { ListError } from '../../components/ui/ListError';
import { useElectionPages } from '../../hooks/useElectionPages';
import { usePageLimit } from '../../hooks/usePageLimit';
import { useVoterIdentity } from '../../hooks/useVoterIdentity';
import { useElectionFilterParams } from '../../hooks/useElectionFilterParams';
import { ElectionFilters } from '../../components/ui/ElectionFilters';
import { matchesQuery, canVoteNow } from '../../lib/electionFilter';
import { syncSavedElections } from '../../lib/savedElections';
import { useSavedElections } from '../../hooks/useSavedElections';
import { sortElections } from '../../lib/electionSort';
import { Button } from '../../components/ui/Button';
import { isChainConfigured } from '../../lib/deployments';

export default function VoterElections() {
  const { t } = useTranslation();

  const live = isChainConfigured();
  const { ready: identityReady, unlocking, unlock } = useVoterIdentity(live);
  /**
   * Read in full, drawn a page at a time.
   *
   * `enrolled` resolves through the `MemberEnrolled` index, so this reads the
   * elections this voter joined and no others: the screen used to hydrate every
   * election on the platform to find the three that were theirs. Since the set is
   * bounded by the voter's own participation it is read completely, which is what
   * keeps the count in the header and the "ending soon" warning exact. A voter
   * who is warned about none of their deadlines because the election was on the
   * second page has been failed by the feature.
   */
  const { isSaved } = useSavedElections();
  const { all: myElections, loading, error, refresh } = useElectionPages({
    scope: 'enrolled',
    hydrateAll: true,
    // Saved as well as joined: an election kept for later has no leaf with
    // this voter in it, which is exactly why it was worth saving.
    keep: e => Boolean(e.isEnrolled || e.hasVoted || isSaved(e.id)),
  });

  // Snapshot the clock once at mount so render stays pure (the count doesn't
  // need second-by-second accuracy; Countdown handles the ticking).
  const [now] = useState(() => Date.now());

  /**
   * Bring the saved list here from wherever else it was changed.
   *
   * ON THIS SCREEN and not on app start, because this is the screen that shows
   * the answer: a voter who saved something on their phone comes here to find
   * it. It needs the identity to be unlocked already and says nothing when it
   * is not, so opening a list never summons an authenticator. Pushing is the
   * library's own business and happens wherever a star is pressed.
   */
  useEffect(() => {
    void syncSavedElections().then(() => refresh());
    // Once per visit. `refresh` is stable and re-running on every render would
    // turn a list into a poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * SEARCH AND ORDER, and not the panel behind the filter button.
   *
   * Those filters are for choosing an election to join: age, nationality,
   * voting rule, the two promises. Here the voter has already joined, and the
   * one axis they narrow by is which phase, which the tabs above do faster
   * than a panel could. What a growing list does need is a name to search for
   * and a way to put the soonest deadline first.
   *
   * In the query string like every other list, so stepping into an election
   * and back brings the search with it.
   */
  const [filters, setFilters] = useElectionFilterParams();
  const [filtersOpen, setFiltersOpen] = useState(false);


  /**
   * SHOWN WHENEVER THERE IS A LIST, and not above some number of rows.
   *
   * It was above five, on the argument that a toolbar over two rows is
   * furniture. That argument loses to a worse cost: Discover and the
   * organizer's dashboard show this bar whatever the count, so a threshold
   * makes two of the four lists behave differently, by a rule nobody can see
   * and everybody has to learn. Empty is the one case that stays bare, where
   * the screen is already saying there is nothing here.
   */
  const worthSearching = myElections.length > 0;

  /**
   * The filters this screen offers, and only those.
   *
   * The panel is asked for two bands, so running the whole matcher would let a
   * hand-written URL narrow the list by rules with no control on screen.
   * Clearing still resets everything, so a stray parameter is inert rather
   * than stuck.
   */
  const byTab = myElections.filter(e => {
    if (filters.phase && e.phase !== filters.phase) return false;
    if (filters.savedOnly && !isSaved(e.id)) return false;
    if (filters.enrolledOnly && !e.isEnrolled) return false;
    if (filters.votedOnly && !e.hasVoted) return false;
    if (filters.canVoteNow && !canVoteNow(e)) return false;
    return true;
  });
  // The query alone, because the panel that sets everything else is not
  // offered here: running the whole matcher would let a hand-written URL
  // narrow this list by rules the screen gives no way to see or clear.
  const needle = filters.query.trim().toLowerCase();
  const filtered = sortElections(byTab.filter(e => matchesQuery(e, needle)), filters.sort);
  // Switching tab or searching starts a different list, so it starts at the
  // first page.
  const { visible, hasMore, loadMore } = usePageLimit(
    filtered,
    undefined,
    `${filters.phase ?? ''}${filters.savedOnly}${filters.enrolledOnly}${filters.votedOnly}${filters.canVoteNow}${filters.query}${filters.sort}`,
  );

  const urgentCount = myElections.filter(e => endsSoon(e, now)).length;

  return (
    <PageLayout role="voter" showNav>
      <div className="max-w-3xl mx-auto pt-6 pb-24">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-black tracking-tight text-white">{t('voter_elections.title')}</h1>
            <p className="text-xs text-on-surface-meta mt-0.5">
              {myElections.length} {t('voter_elections.subtitle')}
            </p>
          </div>
          {urgentCount > 0 && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-error/10 border border-error/20 text-error text-xs font-semibold">
              <Bell className="w-3.5 h-3.5" />
              {t('voter_elections.urgent', { count: urgentCount })}
            </div>
          )}
        </div>

        {/* Search, the state filters and the order, in the bar every other
            list uses. The nine phase chips used to sit open above the list,
            which at a phone's width was five rows of header before a single
            election; behind the button they are one row of a panel nobody has
            to look at. Two bands are asked for, the election's own state and
            the reader's part in it; the rest of that panel is there to help
            somebody choose an election to join. */}
        {worthSearching && (
          <div className="mb-4">
            <ElectionFilters
              value={filters}
              onChange={setFilters}
              open={filtersOpen}
              onToggleOpen={() => setFiltersOpen(open => !open)}
              searchPlaceholder={t('voter_elections.search_placeholder')}
              groups={['status', 'participation']}
            />
          </div>
        )}

        {/* List */}
        {loading ? (
          <div className="flex justify-center py-20"><Spinner /></div>
        ) : error ? (
          <ListError onRetry={() => void refresh()} />
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <span className="text-4xl mb-3">📋</span>
            {/* TWO WAYS TO BE EMPTY, and they need different sentences. With
                filters on, "you have not joined any election" is simply false:
                the voter has some, and the screen is hiding them. It said that
                anyway, and offered a passkey prompt to fix a problem the
                reader did not have. The words are Discover's, because it is
                the same situation and it already answers it. Clearing is the
                link beside the count, which is on screen throughout. */}
            {myElections.length > 0 ? (
              <>
                <p className="text-on-surface-variant text-sm">{t('discover.empty_title')}</p>
                <p className="text-on-surface-meta text-xs mt-1">{t('discover.empty_desc')}</p>
              </>
            ) : (
              <>
                <p className="text-on-surface-variant text-sm">{t('voter_elections.empty')}</p>
                {/* EMPTY CAN MEAN LOCKED. Each election holds a commitment
                    derived from the voter's secret, so finding their own
                    elections needs that secret: a browser that has not
                    unlocked it reads an empty list and cannot tell that from
                    having joined nothing. Offered rather than done on load,
                    because opening the secret summons an authenticator, and
                    that is not something to do to somebody who was only
                    looking. */}
                {live && !identityReady && (
                  <Button
                    variant="ghost"
                    className="mt-4 gap-2 rounded-2xl h-11"
                    disabled={unlocking}
                    onClick={() => { void unlock().then(() => refresh()); }}
                  >
                    <KeyRound className="w-4 h-4" />
                    {unlocking ? t('common.loading') : t('election.check_enrolment')}
                  </Button>
                )}
              </>
            )}
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-3">
              {visible.map(e => (
                <ElectionCard key={e.id} election={e} view="voter" />
              ))}
            </div>
            {/* Nothing is being fetched: the whole set is already here and this
                only widens what is drawn, so it never shows a spinner. */}
            <LoadMore hasMore={hasMore} loading={false} onClick={loadMore} />
          </>
        )}
      </div>
    </PageLayout>
  );
}
