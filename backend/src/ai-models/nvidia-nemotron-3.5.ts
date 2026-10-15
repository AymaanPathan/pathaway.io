import "dotenv/config";
import OpenAI from "openai";

export const NVIDIA_MODEL = "nvidia/nemotron-3.5-lightning-30b-a3b";

const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;

if (!NVIDIA_API_KEY) {
  throw new Error("Missing NVIDIA_API_KEY");
}

export const nvidia = new OpenAI({
  apiKey: NVIDIA_API_KEY,
  baseURL: "https://integrate.api.nvidia.com/v1",
});
