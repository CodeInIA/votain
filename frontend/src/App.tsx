import { lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { useRouteMeta } from './seo/usePageMeta';
import { ToastProvider } from './components/ui/Toast';
import { AuthProvider } from './contexts/AuthProvider';
import { RequireVoter, RequireOrganizer } from './components/auth/RequireAuth';
import Landing from './pages/Landing';


// Public

// Voter

// Organizer

// Shared
import NotFound from './pages/shared/NotFound';

/**
 * One chunk per screen.
 *
 * Every page used to be imported statically, so a visitor reading the privacy
 * policy downloaded the create-election wizard, the ZK proof generator and the
 * tally screen with it: 868 kB of application code in a single file. Each is
 * fetched now when its route is first shown.
 *
 * Landing and NotFound stay eager on purpose. Landing is where a cold visit
 * begins, and deferring it puts a network round trip before the first paint of
 * the most linked URL on the site; NotFound is small enough that a loading
 * state would cost more than the bytes.
 */
const Onboarding = lazy(() => import('./pages/voter/Onboarding'));
const SignIn = lazy(() => import('./pages/voter/SignIn'));
const Discover = lazy(() => import('./pages/public/Discover'));
const ElectionPage = lazy(() => import('./pages/ElectionPage'));
const ElectionResults = lazy(() => import('./pages/public/ElectionResults'));
const HowItWorks = lazy(() => import('./pages/public/HowItWorks'));
const Terms = lazy(() => import('./pages/public/Terms'));
const Privacy = lazy(() => import('./pages/public/Privacy'));
const VerifyReceipt = lazy(() => import('./pages/public/VerifyReceipt'));
const VoterElections = lazy(() => import('./pages/voter/VoterElections'));
const ZkProofGeneration = lazy(() => import('./pages/voter/ZkProofGeneration'));
const VoteConfirmation = lazy(() => import('./pages/voter/VoteConfirmation'));
const ChangeVote = lazy(() => import('./pages/voter/ChangeVote'));
const VoterHistory = lazy(() => import('./pages/voter/VoterHistory'));
const VoterProfile = lazy(() => import('./pages/voter/VoterProfile'));
const ReVerification = lazy(() => import('./pages/voter/ReVerification'));
const RecoverPhrase = lazy(() => import('./pages/voter/RecoverPhrase'));
const IdentityStepPage = lazy(() => import('./pages/voter/IdentityStep'));
const OrganizerAuth = lazy(() => import('./pages/organizer/OrganizerAuth'));
const OrganizerDashboard = lazy(() => import('./pages/organizer/OrganizerDashboard'));
const CreateElection = lazy(() => import('./pages/organizer/CreateElection'));
const ElectionManagement = lazy(() => import('./pages/organizer/ElectionManagement'));
const GasManagement = lazy(() => import('./pages/organizer/GasManagement'));
const MemberList = lazy(() => import('./pages/organizer/MemberList'));
const OrganizerProfile = lazy(() => import('./pages/organizer/OrganizerProfile'));


const ComponentsShowcase = import.meta.env.DEV
  ? lazy(() => import('./pages/dev/Components'))
  : null;

const Fallback = () => (
  <div className="min-h-dvh bg-background flex items-center justify-center text-on-surface-meta text-sm">
    Loading…
  </div>
);

/**
 * Canonical URL and indexability for whatever route is showing.
 *
 * Inside the Router because it reads the location, and separate from App so
 * that reading the location is all it does.
 */
function RouteMeta() {
  useRouteMeta();
  return null;
}

export default function App() {
  return (
    <AuthProvider>
    <ToastProvider>
      <Router>
        <RouteMeta />
        {/* The phrase modal that used to live here is gone. It was mounted above
            the routes so that no entry point could mint an identity without
            showing the words, but it held them in a module variable and put them
            on screen once: a reload at the wrong instant (a phone evicting a
            backgrounded tab mid-WebAuthn, a dev server restarting) skipped the
            one moment a voter ever sees their phrase, silently. Minting now
            happens in one place, behind a screen at /voter/identity that will
            not move on until the words have been copied. */}
        <Suspense fallback={<Fallback />}>
        <Routes>
          {/* Landing */}
          <Route path="/" element={<Landing />} />

          {/* Public */}
          <Route path="/discover"              element={<Discover />} />
          <Route path="/election/:id"          element={<ElectionPage />} />
          <Route path="/election/:id/results"  element={<ElectionResults />} />
          <Route path="/how-it-works"          element={<HowItWorks />} />
          <Route path="/terms"                 element={<Terms />} />
          <Route path="/privacy"               element={<Privacy />} />
          <Route path="/verify-receipt"        element={<VerifyReceipt />} />

          {/* Voter auth. These two are the sign-in itself, so they are the only
              voter routes that can be public: guarding them would leave nobody
              a way to get a session in the first place. Everything else under
              /voter/ is behind `RequireVoter`. */}
          <Route path="/voter/onboarding"   element={<Onboarding />} />
          <Route path="/voter/signin"       element={<SignIn />} />
          {/* Guarded, though the BACKEND deliberately does not authenticate
              `/identity/recover` by cookie: rotating the identity a human votes
              with must take a fresh World ID proof, so a stolen session is not
              enough. That is untouched. This guard is the UI surface only, and
              it costs nothing, because the only way anybody reaches this screen
              is by verifying with World ID, which issues the session. Public, it
              was a page that mints a passkey and rotates an on-chain commitment,
              offered to visitors who had proven nothing yet. */}
          <Route path="/voter/re-verify"    element={<RequireVoter><ReVerification /></RequireVoter>} />
          {/* The identity step, between World ID answering and being able to
              vote. Guarded for the same reason as recovery: without a session
              there is nothing to inspect and nothing to attach an identity to. */}
          <Route path="/voter/identity"     element={<RequireVoter><IdentityStepPage /></RequireVoter>} />
          {/* Behind the guard: the only way here is a World ID session that
              could not open its identity on this device, and the screen adopts
              a phrase into that session. Public, it let anyone type words into
              a browser with nothing to attach them to. */}
          <Route path="/voter/recover"      element={<RequireVoter><RecoverPhrase /></RequireVoter>} />

          {/* Voter app — requires a voter session (httpOnly VC cookie) */}
          <Route path="/voter/elections"               element={<RequireVoter><VoterElections /></RequireVoter>} />
          {/* No `/voter/election/:id`: the election is one public page at
              `/election/:id`. The steps below stay here, because none of them
              can begin without a session. */}
          <Route path="/voter/election/:id/zk-proof"   element={<RequireVoter><ZkProofGeneration /></RequireVoter>} />
          <Route path="/voter/election/:id/confirmation" element={<RequireVoter><VoteConfirmation /></RequireVoter>} />
          <Route path="/voter/election/:id/change-vote"  element={<RequireVoter><ChangeVote /></RequireVoter>} />
          <Route path="/voter/history"                 element={<RequireVoter><VoterHistory /></RequireVoter>} />
          <Route path="/voter/profile"                 element={<RequireVoter><VoterProfile /></RequireVoter>} />

          {/* Organizer — requires passkey + connected wallet */}
          <Route path="/organizer/auth"           element={<OrganizerAuth />} />
          <Route path="/organizer/dashboard"      element={<RequireOrganizer><OrganizerDashboard /></RequireOrganizer>} />
          <Route path="/organizer/elections/new"  element={<RequireOrganizer><CreateElection /></RequireOrganizer>} />
          <Route path="/organizer/election/:id"   element={<RequireOrganizer><ElectionManagement /></RequireOrganizer>} />
          <Route path="/organizer/gas"            element={<RequireOrganizer><GasManagement /></RequireOrganizer>} />
          <Route path="/organizer/members"        element={<RequireOrganizer><MemberList /></RequireOrganizer>} />
          <Route path="/organizer/profile"        element={<RequireOrganizer><OrganizerProfile /></RequireOrganizer>} />

          {/* DEV */}
          {ComponentsShowcase && (
            <Route
              path="/dev/components"
              element={
                <Suspense fallback={<Fallback />}>
                  <ComponentsShowcase />
                </Suspense>
              }
            />
          )}

          {/* 404 */}
          <Route path="*" element={<NotFound />} />
        </Routes>
        </Suspense>
      </Router>
    </ToastProvider>
    </AuthProvider>
  );
}
