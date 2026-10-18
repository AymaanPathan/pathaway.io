import "dotenv/config";
import OpenAI from "openai";

export const GPT_OSS_NVIDIA_MODEL =
  process.env.NVIDIA_MODEL || "openai/gpt-oss-20b";

export const gptOssNvidia = new OpenAI({
  baseURL: "https://integrate.api.nvidia.com/v1",
  apiKey: process.env.NVIDIA_API_KEY || "missing-nvidia-api-key",
});

export interface GptOssNvidiaRequest {
  system: string;
  user: string;
  maxTokens: number;
  json?: boolean;
  signal?: AbortSignal;
}

export interface GptOssNvidiaClient {
  complete(req: GptOssNvidiaRequest): Promise<string>;
}

export function gptOssNvidiaClient(): GptOssNvidiaClient {
  return {
    async complete(req): Promise<string> {
      if (!process.env.NVIDIA_API_KEY) {
        throw new Error("NVIDIA_API_KEY is missing from backend/.env");
      }

      const response = await gptOssNvidia.chat.completions.create(
        {
          model: GPT_OSS_NVIDIA_MODEL,
          messages: [
            { role: "system", content: req.system },
            { role: "user", content: req.user },
          ],
          temperature: 0.3,
          top_p: 1,
          max_tokens: req.maxTokens,
        },
        {
          signal: req.signal,
          maxRetries: 2,
        },
      );

      const content = response.choices[0]?.message?.content;
      return typeof content === "string" ? content : "";
    },
  };
}
