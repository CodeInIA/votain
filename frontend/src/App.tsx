import { lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { ToastProvider } from './components/ui/Toast';
import { AuthProvider } from './contexts/AuthProvider';
import { RequireVoter, RequireOrganizer } from './components/auth/RequireAuth';
import Landing from './pages/Landing';
import Onboarding from './pages/voter/Onboarding';
import SignIn from './pages/voter/SignIn';

// Public
import Discover from './pages/public/Discover';
import ElectionPreview from './pages/public/ElectionPreview';
import ElectionResults from './pages/public/ElectionResults';
import HowItWorks from './pages/public/HowItWorks';
import Terms from './pages/public/Terms';
import Privacy from './pages/public/Privacy';
import VerifyReceipt from './pages/public/VerifyReceipt';

// Voter
import VoterElections from './pages/voter/VoterElections';
import ElectionDetail from './pages/voter/ElectionDetail';
import ZkProofGeneration from './pages/voter/ZkProofGeneration';
import VoteConfirmation from './pages/voter/VoteConfirmation';
import ChangeVote from './pages/voter/ChangeVote';
import VoterHistory from './pages/voter/VoterHistory';
import VoterProfile from './pages/voter/VoterProfile';
import ReVerification from './pages/voter/ReVerification';

// Organizer
import OrganizerAuth from './pages/organizer/OrganizerAuth';
import OrganizerDashboard from './pages/organizer/OrganizerDashboard';
import CreateElection from './pages/organizer/CreateElection';
import ElectionManagement from './pages/organizer/ElectionManagement';
import GasManagement from './pages/organizer/GasManagement';
import MemberList from './pages/organizer/MemberList';
import OrganizerProfile from './pages/organizer/OrganizerProfile';

// Shared
import NotFound from './pages/shared/NotFound';

const ComponentsShowcase = import.meta.env.DEV
  ? lazy(() => import('./pages/dev/Components'))
  : null;

const Fallback = () => (
  <div className="min-h-dvh bg-background flex items-center justify-center text-on-surface-meta text-sm">
    Loading…
  </div>
);

export default function App() {
  return (
    <AuthProvider>
    <ToastProvider>
      <Router>
        <Routes>
          {/* Landing */}
          <Route path="/" element={<Landing />} />

          {/* Public */}
          <Route path="/discover"              element={<Discover />} />
          <Route path="/election/:id"          element={<ElectionPreview />} />
          <Route path="/election/:id/results"  element={<ElectionResults />} />
          <Route path="/how-it-works"          element={<HowItWorks />} />
          <Route path="/terms"                 element={<Terms />} />
          <Route path="/privacy"               element={<Privacy />} />
          <Route path="/verify-receipt"        element={<VerifyReceipt />} />

          {/* Voter auth */}
          <Route path="/voter/onboarding"   element={<Onboarding />} />
          <Route path="/voter/signin"       element={<SignIn />} />
          <Route path="/voter/re-verify"    element={<ReVerification />} />

          {/* Voter app — requires a voter session (httpOnly VC cookie) */}
          <Route path="/voter/elections"               element={<RequireVoter><VoterElections /></RequireVoter>} />
          <Route path="/voter/election/:id"            element={<RequireVoter><ElectionDetail /></RequireVoter>} />
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
      </Router>
    </ToastProvider>
    </AuthProvider>
  );
}
