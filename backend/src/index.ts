import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import "dotenv/config";
import topicsRouter from "./routes/topics-route.js";
import { authRouter } from "./routes/auth-routes.js";
import { onboardingRouter } from "./routes/onboarding-routes.js";
import { graphSkillRouter } from "./routes/graph-skill-routes.js";
import { goalRouter } from "./routes/goal-route.js";
import topicsChatRouter from "./routes/chat.route.js";
import { missionRoutes } from "./routes/mission-route.js";
import { getGraph } from "./db/falkordb.js";
import { cerebrasClient } from "./agents/goal-agent.js";
import { githubInspector } from "./service/mission-repo.service.js";
import { requireAuth } from "./middleware/requireAuth.js";

const FRONTEND_URL = process.env.FRONTEND_URL ?? "http://localhost:5173";
export const app = express();

app.use(cors({ origin: FRONTEND_URL, credentials: true }));
app.use(
  express.json({
    verify: (req, _res, buf) => {
      (req as any).rawBody = buf;
    },
  }),
);
app.use(cookieParser());
app.use((req, _res, next) => {
  console.log("REQUEST:", req.method, req.url);
  next();
});
app.use(authRouter);
app.use(onboardingRouter);
app.use(graphSkillRouter);
app.use(topicsRouter);
app.use(topicsChatRouter);
app.use(goalRouter);

const missionGraph = await getGraph();
app.use(
  "/api/missions",
  requireAuth,
  missionRoutes({
    graph: missionGraph,
    llm: cerebrasClient(),
    inspector: githubInspector(),
  }),
);

const PORT = Number(process.env.PORT ?? 4000);
app.listen(PORT, () => console.log(`API running on http://localhost:${PORT}`));
