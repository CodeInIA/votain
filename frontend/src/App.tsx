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
        <Route path="/voter/verify" element={<div className="p-8 text-center text-white">Verify Step (Work In Progress)</div>} />

        {/* Organizer Routes */}
        <Route path="/organizer/auth" element={<div className="p-8 text-center text-white">Organizer Auth (Work In Progress)</div>} />
        
        {/* Public Routes */}
        <Route path="/discover" element={<div className="p-8 text-center text-white">Public Discovery (Work In Progress)</div>} />
        <Route path="/how-it-works" element={<div className="p-8 text-center text-white">How It Works (Work In Progress)</div>} />
      </Routes>
    </Router>
  );
}
