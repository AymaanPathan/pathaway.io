import "./index.css";
import { Suspense } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Canvas } from "@react-three/fiber";
import * as THREE from "three";

import Landing from "./landing/landing";

import { WorldProvider } from "../city/WorldContext";
import { DeliveryPackages } from "../city/Path";
import { DeveloperCity } from "../city/DeveloperHome";
import { SkillSatellites } from "../city/Satelities";
import { CameraRig } from "../city/CameraRig";
import { HomeAtmosphere, HomeGround } from "../city/Ground";

import Onboarding from "./pages/Onboarding";
import { SkillEvidencePanel } from "../city/SkillEvidencePanel";
import { UIOverlay } from "../city/uiOverlay";
import OverviewPage from "./pages/OverviewPage";
import GoalPage from "./pages/GoalPage";
import MissionPage from "./pages/MissionPage";

function Graph() {
  return (
    <WorldProvider>
      <div
        style={{
          width: "100vw",
          height: "100vh",
          background: "#FBDD7E",
        }}
      >
        <Canvas
          dpr={[1, 1.5]}
          shadows={{ type: THREE.PCFSoftShadowMap }}
          camera={{
            // roughly the city overview shot, so there's no visible jump
            // before CameraRig takes over
            position: [12, 18, 23],
            fov: 42,
            near: 0.1,
            far: 260,
          }}
          gl={{
            antialias: true,
            powerPreference: "high-performance",
            alpha: false,
            stencil: false,
          }}
          onCreated={({ gl }) => {
            gl.toneMapping = THREE.ACESFilmicToneMapping;
            gl.toneMappingExposure = 1.2;
            gl.outputColorSpace = THREE.SRGBColorSpace;
          }}
        >
          <Suspense fallback={null}>
            <HomeAtmosphere />
            <HomeGround />
            <DeveloperCity />
            <SkillSatellites />
            <DeliveryPackages />
            <CameraRig />
          </Suspense>
        </Canvas>

        <UIOverlay />
        <SkillEvidencePanel />
      </div>
    </WorldProvider>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/onboarding" element={<Onboarding />} />
        <Route path="/graph" element={<Graph />} />
        <Route path="/overview" element={<OverviewPage />} />
        <Route path="/goal" element={<GoalPage />} />
        <Route path="/mission" element={<MissionPage />} />
      </Routes>
    </BrowserRouter>
  );
}
