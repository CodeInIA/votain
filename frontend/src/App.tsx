import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import Landing from "./pages/Landing";
import Onboarding from "./pages/voter/Onboarding";

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Landing />} />

        {/* Voter Routes */}
        <Route path="/voter/onboarding" element={<Onboarding />} />
        <Route path="/voter/dashboard" element={<div className="min-h-dvh bg-background p-8 flex items-center justify-center text-center text-white"><h1 className="text-3xl font-heading font-medium tracking-tight">Votain Dashboard</h1><p className="text-on-surface-meta mt-2">Welcome to the dApp</p></div>} />

        {/* Organizer Routes */}
        <Route path="/organizer/auth" element={<div className="p-8 text-center text-white">Organizer Auth (Work In Progress)</div>} />
        
        {/* Public Routes */}
        <Route path="/discover" element={<div className="p-8 text-center text-white">Public Discovery (Work In Progress)</div>} />
        <Route path="/how-it-works" element={<div className="p-8 text-center text-white">How It Works (Work In Progress)</div>} />
      </Routes>
    </Router>
  );
}
