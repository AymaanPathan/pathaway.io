import "./index.css";
import { BrowserRouter, Routes, Route } from "react-router-dom";

import Landing from "./landing/landing";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
      </Routes>
    </BrowserRouter>
  );
}
