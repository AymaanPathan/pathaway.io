import "dotenv/config";
import OpenAI from "openai";

export const CEREBRAS_MODEL = "gpt-oss-120b";

const CEREBRAS_API_KEY = process.env.CEREBRAS_API_KEY;

if (!CEREBRAS_API_KEY) {
  throw new Error("Missing CEREBRAS_API_KEY");
}

export const cerebras = new OpenAI({
  apiKey: CEREBRAS_API_KEY,
  baseURL: "https://api.cerebras.ai/v1",
});
