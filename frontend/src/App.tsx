import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import Landing from "./pages/Landing";

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Landing />} />
        {/* Future routes will go here guided by react-router-dom */}
        <Route path="/discover" element={<div className="p-8 text-center text-white">Public Discovery (Work In Progress)</div>} />
        <Route path="/how-it-works" element={<div className="p-8 text-center text-white">How It Works (Work In Progress)</div>} />
      </Routes>
    </Router>
  );
}
