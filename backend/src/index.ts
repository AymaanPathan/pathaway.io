import express from "express";

export const app = express();

app.get("/", (_req, res) => {
  res.send("Hello World!");
});

const PORT = Number(process.env.PORT ?? 4000);

app.listen(PORT, () => {
  console.log(`API running on http://localhost:${PORT}`);
});
