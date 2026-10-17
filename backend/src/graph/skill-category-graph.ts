import type { Graph } from "../db/falkordb.js";

type AnyObject = Record<string, any>;
export type ProgressFn = (stage: string, detail?: AnyObject) => void;

const LOG_PREFIX = "[skill-agent]";

function log(message: string, detail?: AnyObject): void {
  if (detail !== undefined) {
    console.log(`${LOG_PREFIX} ${message}`, detail);
  } else {
    console.log(`${LOG_PREFIX} ${message}`);
  }
}

function logError(message: string, error: unknown): void {
  console.error(`${LOG_PREFIX} ${message}`, error);
}

function nowMs(): number {
  return Date.now();
}

function elapsedMs(startedAt: number): number {
  return Date.now() - startedAt;
}

// ============================================================
// TAXONOMY TYPES
//
// Signal strength per FileChange:
//   2 = strong  -> definitive path (Dockerfile, schema.prisma), a real
//                  import / API call in the added code, or the file's
//                  language for language skills
//   1 = weak    -> language-only for framework skills, a path hint
//                  (.tsx), or a skill implied by another (Next.js -> React)
//   0 = none
//
// Weak evidence counts for a fraction of strong evidence and lowers
// the evidence-quality multiplier on the final score.
// ============================================================

export interface SkillDefinition {
  id: string;
  name: string;
  category: string;
  /** File language(s) (lowercase) that count as evidence. */
  matchLanguages?: string[];
  /** When true, a language match is strong evidence (e.g. TypeScript). */
  strongLanguage?: boolean;
  /** Definitive path patterns (Dockerfile, schema.prisma ...). */
  pathPatterns?: RegExp[];
  /** Weak path hints (.tsx, pages/ ...). */
  hintPathPatterns?: RegExp[];
  /** Patterns run against the added code. Always strong. */
  codePatterns?: RegExp[];
  /** Skills that this skill proves a little of (Next.js -> React). */
  implies?: string[];
  /** Skills that usually sit next to this one. Used for "what next". */
  related?: string[];
}

export interface SkillCategoryDefinition {
  id: string;
  name: string;
}

export const SKILL_CATEGORIES: SkillCategoryDefinition[] = [
  { id: "languages", name: "Languages" },
  { id: "frontend", name: "Frontend" },
  { id: "backend", name: "Backend" },
  { id: "database", name: "Database & Storage" },
  { id: "ai", name: "AI & LLM" },
  { id: "devops", name: "DevOps & Infrastructure" },
  { id: "testing", name: "Testing & QA" },
  { id: "tooling", name: "Build & Tooling" },
  { id: "graphics", name: "3D, Graphics & Data Viz" },
  { id: "mobile", name: "Mobile" },
  { id: "blockchain", name: "Blockchain" },
];

function language(
  id: string,
  name: string,
  ...langs: string[]
): SkillDefinition {
  return {
    id,
    name,
    category: "languages",
    matchLanguages: langs,
    strongLanguage: true,
  };
}

export const SKILL_TAXONOMY: SkillDefinition[] = [
  // ---------------- Languages ----------------
  language("typescript", "TypeScript", "typescript"),
  language("javascript", "JavaScript", "javascript"),
  language("python", "Python", "python"),
  language("java", "Java", "java"),
  language("go", "Go", "go"),
  language("rust", "Rust", "rust"),
  language("c", "C", "c"),
  language("cpp", "C++", "cpp"),
  language("csharp", "C#", "csharp"),
  language("ruby", "Ruby", "ruby"),
  language("php", "PHP", "php"),
  language("swift", "Swift", "swift"),
  language("kotlin", "Kotlin", "kotlin"),
  language("scala", "Scala", "scala"),
  language("dart", "Dart", "dart"),
  language("elixir", "Elixir", "elixir"),
  language("lua", "Lua", "lua"),

  // ---------------- Frontend ----------------
  {
    id: "react",
    name: "React",
    category: "frontend",
    hintPathPatterns: [/\.(tsx|jsx)$/],
    codePatterns: [
      /from\s+['"]react['"]/,
      /require\(\s*['"]react['"]\s*\)/,
      /\buse(State|Effect|Memo|Callback|Ref|Reducer|Context)\s*\(/,
    ],
  },
  {
    id: "nextjs",
    name: "Next.js",
    category: "frontend",
    pathPatterns: [/next\.config\.(js|ts|mjs|cjs)$/],
    hintPathPatterns: [
      /(^|\/)pages\/.*\.(tsx|jsx|ts|js)$/,
      /(^|\/)app\/.*\.(tsx|jsx)$/,
    ],
    codePatterns: [/from\s+['"]next(\/|['"])/],
  },
  {
    id: "vue",
    name: "Vue.js",
    category: "frontend",
    matchLanguages: ["vue"],
    pathPatterns: [/\.vue$/],
    codePatterns: [/from\s+['"]vue['"]/],
  },
  {
    id: "svelte",
    name: "Svelte",
    category: "frontend",
    matchLanguages: ["svelte"],
    pathPatterns: [/\.svelte$/],
  },
  {
    id: "angular",
    name: "Angular",
    category: "frontend",
    codePatterns: [/@Component\s*\(/, /from\s+['"]@angular\//],
  },
  {
    id: "tailwind",
    name: "Tailwind CSS",
    category: "frontend",
    pathPatterns: [/tailwind\.config\.(js|ts|cjs|mjs)$/],
    codePatterns: [
      /@tailwind\s+(base|components|utilities)/,
      /@import\s+['"]tailwindcss/,
      /className=["'`{][^"'`}]{0,200}\b(flex|grid|px-\d|py-\d|bg-\w|text-(xs|sm|lg|xl)|rounded-\w)/,
    ],
  },
  {
    id: "css",
    name: "CSS / Styling",
    category: "frontend",
    pathPatterns: [/\.(css|scss|sass|less)$/],
  },
  {
    id: "redux",
    name: "Redux / State Mgmt",
    category: "frontend",
    codePatterns: [
      /from\s+['"]@reduxjs\/toolkit['"]/,
      /from\s+['"]redux['"]/,
      /from\s+['"](zustand|jotai|recoil|mobx)['"]/,
    ],
  },
  {
    id: "react_query",
    name: "Data Fetching (TanStack Query / SWR)",
    category: "frontend",
    codePatterns: [
      /from\s+['"]@tanstack\/react-query['"]/,
      /from\s+['"]react-query['"]/,
      /from\s+['"]swr['"]/,
    ],
  },
  {
    id: "framer_motion",
    name: "Animation (Framer Motion / GSAP)",
    category: "frontend",
    codePatterns: [
      /from\s+['"](framer-motion|motion\/react|gsap|react-spring|@react-spring\/\w+)['"]/,
    ],
  },

  // ---------------- Backend ----------------
  {
    id: "nodejs",
    name: "Node.js",
    category: "backend",
    hintPathPatterns: [/(^|\/)package\.json$/],
    codePatterns: [
      /require\(\s*['"](fs|path|http|https|crypto|os|child_process|stream)['"]\s*\)/,
      /from\s+['"]node:/,
      /\bprocess\.(env|argv|on|exit)\b/,
    ],
  },
  {
    id: "express",
    name: "Express.js",
    category: "backend",
    codePatterns: [
      /from\s+['"]express['"]/,
      /require\(\s*['"]express['"]\s*\)/,
      /\bexpress\(\s*\)/,
    ],
  },
  {
    id: "fastify",
    name: "Fastify / Hono",
    category: "backend",
    codePatterns: [/from\s+['"](fastify|hono)['"]/, /\bFastify\s*\(/],
  },
  {
    id: "nestjs",
    name: "NestJS",
    category: "backend",
    codePatterns: [
      /from\s+['"]@nestjs\//,
      /@Injectable\s*\(/,
      /@Controller\s*\(/,
    ],
  },
  {
    id: "django",
    name: "Django",
    category: "backend",
    codePatterns: [/from\s+django\./, /import\s+django\b/],
  },
  {
    id: "flask",
    name: "Flask",
    category: "backend",
    codePatterns: [/from\s+flask\s+import/, /Flask\(__name__\)/],
  },
  {
    id: "fastapi",
    name: "FastAPI",
    category: "backend",
    codePatterns: [/from\s+fastapi\s+import/, /FastAPI\s*\(/],
  },
  {
    id: "spring",
    name: "Spring / Spring Boot",
    category: "backend",
    codePatterns: [/@SpringBootApplication/, /org\.springframework/],
  },
  {
    id: "rails",
    name: "Ruby on Rails",
    category: "backend",
    codePatterns: [/Rails\.application/, /ActiveRecord::Base/],
  },
  {
    id: "graphql",
    name: "GraphQL",
    category: "backend",
    pathPatterns: [/\.(graphql|gql)$/],
    codePatterns: [
      /from\s+['"]graphql['"]/,
      /\btype\s+Query\s*\{/,
      /from\s+['"]@apollo\//,
    ],
  },
  {
    id: "go_backend",
    name: "Go Services",
    category: "backend",
    matchLanguages: ["go"],
    strongLanguage: true,
  },
  {
    id: "rest_api",
    name: "REST API Design",
    category: "backend",
    codePatterns: [
      /\b(router|app)\.(get|post|put|patch|delete)\(\s*['"`]\//,
      /@(Get|Post|Put|Patch|Delete)Mapping/,
      /@(Get|Post|Put|Patch|Delete)\(\s*['"`]?\//,
    ],
  },
  {
    id: "trpc",
    name: "tRPC",
    category: "backend",
    codePatterns: [/from\s+['"]@trpc\//],
  },
  {
    id: "zod",
    name: "Schema Validation (Zod)",
    category: "backend",
    codePatterns: [
      /from\s+['"](zod|yup|joi|valibot)['"]/,
      /\bz\.(object|string|number|array|enum)\s*\(/,
    ],
  },
  {
    id: "auth",
    name: "Authentication & Authorization",
    category: "backend",
    codePatterns: [
      /from\s+['"](jsonwebtoken|passport|bcrypt|bcryptjs|argon2|jose|next-auth|@auth\/\w+)['"]/,
      /require\(\s*['"](jsonwebtoken|passport|bcrypt)['"]\s*\)/,
      /\bjwt\.(sign|verify)\s*\(/,
      /\bexchangeCodeForToken\b|\bgetAuthorizeUrl\b/,
    ],
  },
  {
    id: "websockets",
    name: "WebSockets / SSE",
    category: "backend",
    codePatterns: [
      /from\s+['"](ws|socket\.io|socket\.io-client)['"]/,
      /new\s+WebSocket\s*\(/,
      /text\/event-stream/,
      /new\s+EventSource\s*\(/,
    ],
  },
  {
    id: "bullmq",
    name: "Job Queues (BullMQ)",
    category: "backend",
    codePatterns: [
      /from\s+['"](bullmq|bull|bee-queue|agenda)['"]/,
      /require\(\s*['"](bullmq|bull)['"]\s*\)/,
    ],
  },
  {
    id: "message_brokers",
    name: "Message Brokers (Kafka / RabbitMQ / SQS)",
    category: "backend",
    codePatterns: [
      /from\s+['"](kafkajs|amqplib|nats|@google-cloud\/pubsub)['"]/,
      /from\s+['"]@aws-sdk\/client-sqs['"]/,
      /\b(confluent_kafka|import\s+pika)\b/,
    ],
  },

  // ---------------- Database & storage ----------------
  {
    id: "sql",
    name: "SQL",
    category: "database",
    matchLanguages: ["sql"],
    strongLanguage: true,
    pathPatterns: [/\.sql$/],
    codePatterns: [
      /\bCREATE\s+TABLE\b/i,
      /\bINSERT\s+INTO\b/i,
      /\bSELECT\b[^;]{0,200}?\bFROM\b/i,
    ],
  },
  {
    id: "postgres",
    name: "PostgreSQL",
    category: "database",
    codePatterns: [
      /require\(\s*['"]pg['"]\s*\)/,
      /from\s+['"](pg|postgres)['"]/,
      /postgres(ql)?:\/\//,
      /\bpsycopg2?\b/,
    ],
  },
  {
    id: "mysql",
    name: "MySQL",
    category: "database",
    codePatterns: [
      /require\(\s*['"]mysql2?['"]\s*\)/,
      /from\s+['"]mysql2?(\/promise)?['"]/,
    ],
  },
  {
    id: "mongodb",
    name: "MongoDB",
    category: "database",
    codePatterns: [
      /from\s+['"]mongoose['"]/,
      /require\(\s*['"]mongoose['"]\s*\)/,
      /\bMongoClient\b/,
    ],
  },
  {
    id: "redis",
    name: "Redis",
    category: "database",
    codePatterns: [
      /from\s+['"](redis|ioredis|@upstash\/redis)['"]/,
      /require\(\s*['"](redis|ioredis)['"]\s*\)/,
    ],
  },
  {
    id: "sqlite",
    name: "SQLite",
    category: "database",
    codePatterns: [
      /from\s+['"](better-sqlite3|sqlite3|sqlite)['"]/,
      /\bimport\s+sqlite3\b/,
    ],
  },
  {
    id: "prisma",
    name: "Prisma ORM",
    category: "database",
    pathPatterns: [/schema\.prisma$/],
    codePatterns: [/from\s+['"]@prisma\/client['"]/],
  },
  {
    id: "drizzle",
    name: "Drizzle / TypeORM / Knex",
    category: "database",
    codePatterns: [
      /from\s+['"](drizzle-orm|typeorm|knex|sequelize)(\/[\w-]+)?['"]/,
    ],
  },
  {
    id: "falkordb",
    name: "FalkorDB / Graph DB",
    category: "database",
    codePatterns: [
      /from\s+['"](falkordb|neo4j-driver)['"]/,
      /\.selectGraph\s*\(/,
      /GRAPH\.QUERY/,
      /\bFalkorDB\s*\(/,
    ],
  },
  {
    id: "cypher",
    name: "Cypher / Graph Queries",
    category: "database",
    codePatterns: [
      /\b(MATCH|MERGE)\s*\(\s*\w*(\s*:\s*\w+)?[^)]{0,120}\)\s*(<?-\s*\[|<?-)/,
      /\bUNWIND\s+\$\w+\s+AS\b/,
      /\bCALL\s+(algo|db)\.\w+/,
    ],
  },

  // ---------------- AI & LLM ----------------
  {
    id: "llm_apis",
    name: "LLM APIs",
    category: "ai",
    codePatterns: [
      /from\s+['"](openai|@anthropic-ai\/sdk|@google\/generative-ai|@google\/genai|groq-sdk|ollama|@mistralai\/mistralai|cohere-ai|ai)['"]/,
      /from\s+['"]@ai-sdk\//,
      /require\(\s*['"](openai|@anthropic-ai\/sdk)['"]\s*\)/,
      /\bimport\s+(openai|anthropic)\b/,
      /\b(chat\.completions|messages)\.create\s*\(/,
    ],
  },
  {
    id: "langchain",
    name: "LangChain",
    category: "ai",
    codePatterns: [
      /from\s+['"](@langchain\/[\w-]+|langchain(\/[\w-]+)?)['"]/,
      /\bfrom\s+langchain(_\w+)?\b/,
    ],
  },
  {
    id: "langgraph",
    name: "LangGraph",
    category: "ai",
    codePatterns: [
      /from\s+['"]@langchain\/langgraph(\/[\w-]+)?['"]/,
      /\bfrom\s+langgraph\b/,
      /\bStateGraph\s*[(<]/,
    ],
  },
  {
    id: "ai_agents",
    name: "AI Agents & Tool Calling",
    category: "ai",
    codePatterns: [
      /\b(tool_calls|tool_choice|tool_use)\b/,
      /\b(createReactAgent|AgentExecutor|ToolNode)\b/,
    ],
  },
  {
    id: "mcp",
    name: "Model Context Protocol",
    category: "ai",
    codePatterns: [
      /from\s+['"]@modelcontextprotocol\/sdk/,
      /\bMcpServer\b/,
      /\bfrom\s+mcp\b/,
    ],
  },
  {
    id: "prompt_engineering",
    name: "Prompt Engineering",
    category: "ai",
    codePatterns: [
      /\b(system_?prompt|SYSTEM_PROMPT)\b/i,
      /role:\s*['"]system['"]/,
      /\bPromptTemplate\b/,
    ],
  },
  {
    id: "vector_search",
    name: "Embeddings & Vector Search",
    category: "ai",
    codePatterns: [
      /from\s+['"](@pinecone-database\/pinecone|@qdrant\/js-client-rest|chromadb|weaviate-ts-client)['"]/,
      /\bembeddings?\.create\s*\(/,
      /\b(embedQuery|embedDocuments)\b/,
      /\bCREATE\s+EXTENSION\b[^;]{0,40}\bvector\b/i,
    ],
  },
  {
    id: "ml_frameworks",
    name: "ML / Data Science",
    category: "ai",
    codePatterns: [
      /\b(import|from)\s+(torch|tensorflow|sklearn|transformers|numpy|pandas)\b/,
    ],
  },

  // ---------------- DevOps & infra ----------------
  {
    id: "docker",
    name: "Docker",
    category: "devops",
    pathPatterns: [
      /(^|\/)Dockerfile(\.[\w-]+)?$/,
      /(^|\/)(docker-)?compose(\.[\w-]+)?\.ya?ml$/,
      /(^|\/)\.dockerignore$/,
    ],
  },
  {
    id: "kubernetes",
    name: "Kubernetes",
    category: "devops",
    pathPatterns: [
      /(^|\/)(k8s|kubernetes|helm)\/.*\.ya?ml$/,
      /(^|\/)Chart\.ya?ml$/,
    ],
    codePatterns: [
      /apiVersion:\s*apps\/v1/,
      /kind:\s*(Deployment|Service|Pod|Ingress|StatefulSet)/,
    ],
  },
  {
    id: "ci_cd",
    name: "CI/CD Pipelines",
    category: "devops",
    pathPatterns: [
      /\.github\/workflows\/.*\.ya?ml$/,
      /\.gitlab-ci\.ya?ml$/,
      /(^|\/)Jenkinsfile$/,
      /(^|\/)\.circleci\/config\.ya?ml$/,
    ],
  },
  {
    id: "terraform",
    name: "Terraform / IaC",
    category: "devops",
    pathPatterns: [/\.(tf|tfvars)$/],
  },
  {
    id: "shell",
    name: "Shell Scripting",
    category: "devops",
    matchLanguages: ["shell"],
    strongLanguage: true,
    pathPatterns: [/\.(sh|bash)$/],
  },
  {
    id: "aws",
    name: "AWS",
    category: "devops",
    pathPatterns: [/(^|\/)serverless\.ya?ml$/],
    codePatterns: [
      /from\s+['"](@aws-sdk\/[\w-]+|aws-sdk|aws-cdk-lib)['"]/,
      /\bimport\s+boto3\b/,
    ],
  },
  {
    id: "opentelemetry",
    name: "OpenTelemetry",
    category: "devops",
    codePatterns: [
      /from\s+['"]@opentelemetry\//,
      /require\(\s*['"]@opentelemetry\//,
      /\bfrom\s+opentelemetry\b/,
    ],
  },
  {
    id: "monitoring",
    name: "Logging & Monitoring",
    category: "devops",
    codePatterns: [
      /from\s+['"](pino|winston|bunyan|prom-client|dd-trace)['"]/,
      /from\s+['"]@sentry\//,
      /\bimport\s+structlog\b/,
    ],
  },

  // ---------------- Testing ----------------
  {
    id: "testing",
    name: "Automated Testing",
    category: "testing",
    pathPatterns: [
      /\.(test|spec)\.(ts|tsx|js|jsx|mjs)$/,
      /(^|\/)(tests?|__tests__)\//,
      /_test\.(go|py)$/,
      /(^|\/)test_[\w-]+\.py$/,
    ],
    codePatterns: [
      /^\s*(describe|it|test)\(\s*['"`]/m,
      /from\s+['"](jest|vitest|mocha|chai|@testing-library\/[\w-]+)['"]/,
      /\b(import|from)\s+pytest\b/,
    ],
  },
  {
    id: "e2e_testing",
    name: "End-to-End Testing",
    category: "testing",
    pathPatterns: [/(^|\/)(cypress|e2e)\//, /\.e2e\.(ts|js)$/],
    codePatterns: [
      /from\s+['"](@playwright\/test|playwright|cypress|puppeteer)['"]/,
    ],
  },

  // ---------------- Tooling ----------------
  {
    id: "vite",
    name: "Vite / Bundlers",
    category: "tooling",
    pathPatterns: [
      /(^|\/)vite\.config\.(ts|js|mjs)$/,
      /(^|\/)(webpack|rollup|esbuild|tsup)\.config\.(ts|js|mjs|cjs)$/,
    ],
    codePatterns: [/from\s+['"]vite['"]/],
  },
  {
    id: "linting",
    name: "Linting & Formatting",
    category: "tooling",
    pathPatterns: [
      /(^|\/)\.eslintrc(\.[\w]+)?$/,
      /(^|\/)eslint\.config\.(js|mjs|ts|cjs)$/,
      /(^|\/)\.prettierrc(\.[\w]+)?$/,
      /(^|\/)biome\.jsonc?$/,
    ],
  },
  {
    id: "monorepo",
    name: "Monorepo Tooling",
    category: "tooling",
    pathPatterns: [
      /(^|\/)(turbo|nx|lerna)\.json$/,
      /(^|\/)pnpm-workspace\.ya?ml$/,
    ],
  },

  // ---------------- 3D / graphics / data viz ----------------
  {
    id: "threejs",
    name: "Three.js",
    category: "graphics",
    codePatterns: [
      /from\s+['"]three(\/[\w./-]+)?['"]/,
      /require\(\s*['"]three['"]\s*\)/,
    ],
  },
  {
    id: "r3f",
    name: "React Three Fiber",
    category: "graphics",
    codePatterns: [/from\s+['"]@react-three\/[\w-]+['"]/],
  },
  {
    id: "d3",
    name: "D3 / Data Visualization",
    category: "graphics",
    codePatterns: [
      /from\s+['"]d3(-[\w-]+)?['"]/,
      /from\s+['"](recharts|chart\.js|visx|@visx\/[\w-]+)['"]/,
    ],
  },
  {
    id: "webgl",
    name: "Canvas / WebGL",
    category: "graphics",
    codePatterns: [/getContext\(\s*['"](webgl2?|2d|webgpu)['"]\s*\)/],
  },
  {
    id: "shaders",
    name: "GLSL / Shaders",
    category: "graphics",
    pathPatterns: [/\.(glsl|frag|vert|wgsl)$/],
    codePatterns: [
      /\bgl_FragColor\b/,
      /\buniform\s+(float|vec[234]|sampler2D)\b/,
    ],
  },

  // ---------------- Mobile ----------------
  {
    id: "react_native",
    name: "React Native",
    category: "mobile",
    codePatterns: [/from\s+['"](react-native|expo)(\/[\w-]+)?['"]/],
  },
  {
    id: "flutter",
    name: "Flutter",
    category: "mobile",
    matchLanguages: ["dart"],
    codePatterns: [/from\s+['"]package:flutter\//, /package:flutter\//],
  },
  {
    id: "ios_native",
    name: "iOS (Swift)",
    category: "mobile",
    matchLanguages: ["swift"],
    codePatterns: [/\bimport\s+(UIKit|SwiftUI)\b/],
  },
  {
    id: "android",
    name: "Android",
    category: "mobile",
    pathPatterns: [/(^|\/)AndroidManifest\.xml$/],
    codePatterns: [/\bimport\s+androidx\./],
  },

  // ---------------- Blockchain ----------------
  {
    id: "solidity",
    name: "Solidity",
    category: "blockchain",
    matchLanguages: ["solidity"],
    strongLanguage: true,
    pathPatterns: [/\.sol$/],
  },
  {
    id: "web3",
    name: "Web3 Clients (ethers / viem / wagmi)",
    category: "blockchain",
    codePatterns: [/from\s+['"](ethers|viem|wagmi|web3|@solana\/web3\.js)['"]/],
  },
];

// ------------------------------------------------------------
// Relationships between skills (static structural knowledge)
// ------------------------------------------------------------

/** Proving X also weakly proves Y. */
const IMPLIES: Record<string, string[]> = {
  nextjs: ["react"],
  react_native: ["react"],
  r3f: ["react", "threejs"],
  express: ["nodejs"],
  fastify: ["nodejs"],
  nestjs: ["nodejs"],
  bullmq: ["redis", "nodejs"],
  trpc: ["typescript"],
  falkordb: ["cypher"],
  tailwind: ["css"],
  langgraph: ["langchain"],
  go_backend: ["go"],
  flutter: ["dart"],
  ios_native: ["swift"],
};

/** Skills that normally travel together. Drives "what to learn next". */
const RELATED: Record<string, string[]> = {
  typescript: ["nodejs", "react", "zod", "testing"],
  javascript: ["typescript", "nodejs", "react"],
  python: ["fastapi", "ml_frameworks", "testing"],
  react: [
    "nextjs",
    "redux",
    "react_query",
    "tailwind",
    "vite",
    "framer_motion",
  ],
  nextjs: ["react", "tailwind", "react_query", "auth"],
  tailwind: ["react", "css", "framer_motion"],
  redux: ["react", "react_query"],
  react_query: ["react", "rest_api"],
  nodejs: ["express", "fastify", "nestjs", "bullmq", "docker"],
  express: ["zod", "auth", "rest_api", "testing", "redis"],
  fastify: ["zod", "rest_api", "opentelemetry"],
  nestjs: ["typescript", "postgres", "auth", "testing"],
  rest_api: ["zod", "auth", "testing", "websockets"],
  graphql: ["typescript", "react_query"],
  trpc: ["zod", "nextjs"],
  zod: ["typescript", "rest_api", "llm_apis"],
  auth: ["rest_api", "zod", "redis"],
  websockets: ["redis", "react", "rest_api"],
  bullmq: ["redis", "opentelemetry", "message_brokers"],
  message_brokers: ["bullmq", "docker", "opentelemetry"],
  postgres: ["prisma", "sql", "redis", "drizzle"],
  prisma: ["postgres", "typescript", "zod"],
  drizzle: ["postgres", "typescript"],
  mongodb: ["nodejs", "express"],
  redis: ["bullmq", "postgres", "websockets"],
  sql: ["postgres", "prisma"],
  falkordb: ["cypher", "redis", "llm_apis"],
  cypher: ["falkordb"],
  llm_apis: [
    "langgraph",
    "ai_agents",
    "vector_search",
    "prompt_engineering",
    "mcp",
    "zod",
  ],
  langchain: ["langgraph", "llm_apis", "vector_search"],
  langgraph: ["llm_apis", "ai_agents", "opentelemetry", "bullmq"],
  ai_agents: ["langgraph", "llm_apis", "mcp", "opentelemetry"],
  mcp: ["llm_apis", "ai_agents", "typescript"],
  prompt_engineering: ["llm_apis", "ai_agents"],
  vector_search: ["llm_apis", "postgres"],
  docker: ["kubernetes", "ci_cd", "terraform", "aws"],
  kubernetes: ["docker", "terraform", "opentelemetry"],
  ci_cd: ["docker", "testing", "terraform"],
  terraform: ["aws", "kubernetes"],
  aws: ["terraform", "docker", "kubernetes"],
  opentelemetry: ["monitoring", "docker", "kubernetes", "bullmq"],
  monitoring: ["opentelemetry"],
  testing: ["e2e_testing", "ci_cd"],
  e2e_testing: ["testing", "ci_cd"],
  vite: ["react", "typescript"],
  monorepo: ["vite", "ci_cd"],
  threejs: ["r3f", "shaders", "webgl"],
  r3f: ["threejs", "shaders", "react", "framer_motion"],
  d3: ["react", "webgl"],
  webgl: ["threejs", "shaders"],
  shaders: ["threejs", "webgl", "r3f"],
  react_native: ["react", "typescript"],
  solidity: ["web3"],
  web3: ["solidity", "react"],
};

for (const def of SKILL_TAXONOMY) {
  def.implies = IMPLIES[def.id] ?? [];
  def.related = RELATED[def.id] ?? [];
}

const DEF_BY_ID = new Map(SKILL_TAXONOMY.map((def) => [def.id, def]));
const CATEGORY_BY_ID = new Map(SKILL_CATEGORIES.map((cat) => [cat.id, cat]));

const IMPLIED_BY = new Map<string, string[]>();
for (const def of SKILL_TAXONOMY) {
  for (const target of def.implies ?? []) {
    const list = IMPLIED_BY.get(target) ?? [];
    list.push(def.id);
    IMPLIED_BY.set(target, list);
  }
}

/** Dev-time guard: catches typos in IMPLIES / RELATED / categories. */
(function validateTaxonomy(): void {
  const seen = new Set<string>();
  for (const def of SKILL_TAXONOMY) {
    if (seen.has(def.id)) log("taxonomy: duplicate skill id", { id: def.id });
    seen.add(def.id);
    if (!CATEGORY_BY_ID.has(def.category)) {
      log("taxonomy: unknown category", { id: def.id, category: def.category });
    }
    for (const ref of [...(def.implies ?? []), ...(def.related ?? [])]) {
      if (!DEF_BY_ID.has(ref)) {
        log("taxonomy: reference to unknown skill", { id: def.id, ref });
      }
    }
  }
  for (const key of [...Object.keys(IMPLIES), ...Object.keys(RELATED)]) {
    if (!DEF_BY_ID.has(key)) log("taxonomy: map key is not a skill", { key });
  }
})();

// ============================================================
// SCORING CONFIG
// ============================================================

const DAY_MS = 24 * 60 * 60 * 1000;

const SCORE_WEIGHTS = {
  volume: 24, // log10 of weighted, per-change-capped lines
  breadth: 22, // distinct files (strong files count fully, weak ones less)
  commits: 20, // distinct commits (sqrt curve: early progress is visible)
  repos: 10, // distinct repositories
  sustained: 24, // active days + how long the skill has been in use
};

const BREADTH_CAP_FILES = 40;
const COMMITS_CAP = 80;
const REPOS_CAP = 6;
const SUSTAIN_DAYS_CAP = 30;
const SUSTAIN_SPAN_CAP_DAYS = 180;

const WEAK_WEIGHT = 0.35; // weak evidence counts for this share of strong
const MAX_LINES_PER_CHANGE = 1200; // generated / pasted dumps can't dominate
const MAX_CODE_SCAN_CHARS = 40_000; // bound regex work on huge diffs

const RECENT_WINDOW_DAYS = 90;
const DORMANT_AFTER_DAYS = 270;

const MIN_COOCCURRENCE = 2;
const MAX_COOCCURRENCE_EDGES = 400;
const ACTIVITY_MONTHS = 18;

export type SkillLevel =
  | "novice"
  | "familiar"
  | "proficient"
  | "advanced"
  | "expert";

export type SkillTrend = "rising" | "steady" | "cooling" | "dormant";
export type SkillConfidence = "high" | "medium" | "low";

function levelForScore(score: number): SkillLevel {
  if (score >= 81) return "expert";
  if (score >= 61) return "advanced";
  if (score >= 36) return "proficient";
  if (score >= 16) return "familiar";
  return "novice";
}

// ============================================================
// HELPERS
// ============================================================

function safeString(value: unknown): string {
  return value == null ? "" : String(value);
}

function safeNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function round(value: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

type QueryPrimitive = string | number | boolean | null;
type QueryParamObject = Record<string, QueryPrimitive>;

function asQueryParams<T extends object>(items: T[]): QueryParamObject[] {
  return items.map((item) => {
    const params: QueryParamObject = {};
    for (const [key, value] of Object.entries(item)) {
      if (
        value === null ||
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
      ) {
        params[key] = value;
      } else {
        throw new TypeError(
          `Unsupported FalkorDB query parameter for "${key}": ${typeof value}`,
        );
      }
    }
    return params;
  });
}

const SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

function assertSafeIdentifier(value: string): string {
  if (!SAFE_IDENTIFIER.test(value)) {
    throw new Error(
      `Refusing to interpolate unsafe identifier into Cypher: "${value}"`,
    );
  }
  return value;
}

const DB_BATCH_SIZE = Math.max(
  1,
  Number(process.env.FALKORDB_BATCH_SIZE ?? 500),
);
const FETCH_PAGE_SIZE = Math.max(
  100,
  Number(process.env.SKILL_AGENT_PAGE_SIZE ?? 500),
);

function dayKey(iso: string): string | null {
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return null;
  return new Date(ts).toISOString().slice(0, 10);
}

function monthKey(iso: string): string | null {
  const key = dayKey(iso);
  return key ? key.slice(0, 7) : null;
}

async function runBatches(
  graph: Graph,
  label: string,
  query: string,
  rows: QueryParamObject[],
): Promise<void> {
  if (rows.length === 0) return;
  const batches = chunkArray(rows, DB_BATCH_SIZE);
  const startedAt = nowMs();
  for (const batch of batches) {
    await graph.query(query, { params: { batch } });
  }
  log(`${label} written`, {
    rows: rows.length,
    batches: batches.length,
    durationMs: elapsedMs(startedAt),
  });
}

// ============================================================
// INDEXES
// ============================================================

const SKILL_INDEXES: Array<{ label: string; property: string }> = [
  { label: "Skill", property: "id" },
  { label: "SkillCategory", property: "id" },
];

async function ensureSkillIndexes(graph: Graph): Promise<void> {
  log("ensuring skill indexes", {
    indexes: SKILL_INDEXES.map((i) => `${i.label}(${i.property})`),
  });

  for (const { label, property } of SKILL_INDEXES) {
    const safeLabel = assertSafeIdentifier(label);
    const safeProperty = assertSafeIdentifier(property);

    try {
      await graph.query(
        `CREATE INDEX FOR (n:${safeLabel}) ON (n.${safeProperty})`,
      );
      log(`index ready: ${safeLabel}(${safeProperty})`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/already\s+(exists|indexed)/i.test(message)) {
        log(`index already exists: ${safeLabel}(${safeProperty})`);
      } else {
        logError(
          `failed to create index on :${safeLabel}(${safeProperty})`,
          message,
        );
      }
    }
  }
}

// ============================================================
// EVIDENCE ROW (what we read back per FileChange)
// ============================================================

interface FileChangeEvidenceRow {
  id: string;
  path: string;
  language: string;
  added_code: string;
  additions: number;
  deletions: number;
  commit_sha: string;
  repository_id: string;
  created_at: string;
}

/**
 * Keyset pagination (WHERE id > last) instead of SKIP: SKIP re-scans every
 * skipped row on each page, so it gets slower with every page. added_code is
 * truncated INSIDE the database so huge diffs never cross the wire.
 */
async function fetchFileChangeEvidence(
  graph: Graph,
  developerId: string,
  onProgress: ProgressFn,
): Promise<FileChangeEvidenceRow[]> {
  const rows: FileChangeEvidenceRow[] = [];
  let lastId = "";
  let page = 0;

  const startedAt = nowMs();
  log("fetching FileChange evidence — start", {
    developerId,
    pageSize: FETCH_PAGE_SIZE,
  });

  while (true) {
    const pageStartedAt = nowMs();

    const result = await graph.query(
      `
      MATCH (d:Developer {id: $developer_id})-[:AUTHORED_CODE]->(fc:FileChange)
      WHERE fc.id > $last_id
      RETURN
        fc.id AS id,
        fc.path AS path,
        fc.language AS language,
        substring(coalesce(fc.added_code, ""), 0, ${MAX_CODE_SCAN_CHARS}) AS added_code,
        fc.additions AS additions,
        fc.deletions AS deletions,
        fc.commit_sha AS commit_sha,
        fc.repository_id AS repository_id,
        fc.created_at AS created_at
      ORDER BY fc.id
      LIMIT ${FETCH_PAGE_SIZE}
      `,
      { params: { developer_id: developerId, last_id: lastId } },
    );

    const pageRows = (result.data ?? []) as AnyObject[];
    page += 1;

    for (const row of pageRows) {
      rows.push({
        id: safeString(row.id),
        path: safeString(row.path),
        language: safeString(row.language),
        added_code: safeString(row.added_code),
        additions: safeNumber(row.additions),
        deletions: safeNumber(row.deletions),
        commit_sha: safeString(row.commit_sha),
        repository_id: safeString(row.repository_id),
        created_at: safeString(row.created_at),
      });
    }

    log(`evidence page ${page} fetched`, {
      pageRows: pageRows.length,
      totalSoFar: rows.length,
      pageDurationMs: elapsedMs(pageStartedAt),
    });

    onProgress("skill_evidence_page", { fetched: rows.length });

    if (pageRows.length < FETCH_PAGE_SIZE) break;
    lastId = safeString(pageRows[pageRows.length - 1].id);
  }

  log("fetching FileChange evidence — done", {
    developerId,
    totalRows: rows.length,
    pages: page,
    durationMs: elapsedMs(startedAt),
  });

  return rows;
}

// ============================================================
// CLASSIFICATION
// ============================================================

export interface SkillEvidenceLike {
  path: string;
  language: string;
  added_code: string;
}

export type SignalStrength = 0 | 1 | 2;

/** Lockfiles, build output, vendored code, binaries, generated files. */
const NOISE_PATH_PATTERNS: RegExp[] = [
  /(^|\/)(node_modules|vendor|\.next|\.nuxt|\.turbo|\.cache|__pycache__)\//,
  /^(dist|build|out|target|coverage)\//,
  /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Cargo\.lock|poetry\.lock|Pipfile\.lock|Gemfile\.lock|composer\.lock|go\.sum)$/,
  /\.(min\.(js|css)|map|snap|lock|svg|png|jpe?g|gif|webp|ico|woff2?|ttf|eot|pdf|mp4|zip)$/i,
  /\.d\.ts$/,
  /(^|\/)__generated__\//,
  /\.generated\./,
];

export function isNoiseFile(path: string): boolean {
  return NOISE_PATH_PATTERNS.some((pattern) => pattern.test(path));
}

export function skillSignal(
  def: SkillDefinition,
  row: SkillEvidenceLike,
): SignalStrength {
  if (def.pathPatterns?.some((pattern) => pattern.test(row.path))) return 2;

  if (
    row.added_code &&
    def.codePatterns?.some((pattern) => pattern.test(row.added_code))
  ) {
    return 2;
  }

  if (def.matchLanguages?.length && def.matchLanguages.includes(row.language)) {
    return def.strongLanguage ? 2 : 1;
  }

  if (def.hintPathPatterns?.some((pattern) => pattern.test(row.path))) return 1;

  return 0;
}

/** Kept for backwards compatibility with other modules. */
export function matchesSkill(
  def: SkillDefinition,
  row: SkillEvidenceLike,
): boolean {
  return skillSignal(def, row) > 0;
}

interface RowMatch {
  strength: 1 | 2;
  implied: boolean;
}

/** All skills a single FileChange is evidence for (incl. implied ones). */
function classifyRow(row: SkillEvidenceLike): Map<string, RowMatch> {
  const matches = new Map<string, RowMatch>();

  for (const def of SKILL_TAXONOMY) {
    const strength = skillSignal(def, row);
    if (strength > 0) {
      matches.set(def.id, { strength: strength as 1 | 2, implied: false });
    }
  }

  for (const [id, match] of [...matches]) {
    if (match.strength !== 2) continue;
    for (const target of DEF_BY_ID.get(id)?.implies ?? []) {
      if (!matches.has(target)) {
        matches.set(target, { strength: 1, implied: true });
      }
    }
  }

  return matches;
}

interface RepoUsage {
  files: Set<string>;
  commits: Set<string>;
  lines: number;
  lastTs: number;
}

interface SkillAggregate {
  skillId: string;
  filePaths: Set<string>;
  strongFilePaths: Set<string>;
  commitShas: Set<string>;
  recentShas: Set<string>;
  priorShas: Set<string>;
  repositoryIds: Set<string>;
  activeDayKeys: Set<string>;
  monthCommits: Map<string, Set<string>>;
  repoUsage: Map<string, RepoUsage>;
  linesAdded: number;
  linesDeleted: number;
  weightedLines: number;
  firstSeenTs: number;
  lastSeenTs: number;
}

function newAggregate(skillId: string): SkillAggregate {
  return {
    skillId,
    filePaths: new Set(),
    strongFilePaths: new Set(),
    commitShas: new Set(),
    recentShas: new Set(),
    priorShas: new Set(),
    repositoryIds: new Set(),
    activeDayKeys: new Set(),
    monthCommits: new Map(),
    repoUsage: new Map(),
    linesAdded: 0,
    linesDeleted: 0,
    weightedLines: 0,
    firstSeenTs: Number.POSITIVE_INFINITY,
    lastSeenTs: 0,
  };
}

function addToAggregate(
  agg: SkillAggregate,
  row: FileChangeEvidenceRow,
  match: RowMatch,
  now: number,
): void {
  const lines = row.additions + row.deletions;
  const cappedLines = Math.min(lines, MAX_LINES_PER_CHANGE);
  const weight = match.strength === 2 ? 1 : WEAK_WEIGHT;

  agg.filePaths.add(row.path);
  if (match.strength === 2) agg.strongFilePaths.add(row.path);

  agg.linesAdded += row.additions;
  agg.linesDeleted += row.deletions;
  agg.weightedLines += cappedLines * weight;

  if (row.commit_sha) agg.commitShas.add(row.commit_sha);
  if (row.repository_id) agg.repositoryIds.add(row.repository_id);

  const ts = new Date(row.created_at).getTime();
  if (Number.isFinite(ts)) {
    agg.firstSeenTs = Math.min(agg.firstSeenTs, ts);
    agg.lastSeenTs = Math.max(agg.lastSeenTs, ts);

    const ageDays = (now - ts) / DAY_MS;
    if (row.commit_sha) {
      if (ageDays <= RECENT_WINDOW_DAYS) agg.recentShas.add(row.commit_sha);
      else if (ageDays <= RECENT_WINDOW_DAYS * 2) {
        agg.priorShas.add(row.commit_sha);
      }
    }
  }

  const day = dayKey(row.created_at);
  if (day) agg.activeDayKeys.add(day);

  const month = monthKey(row.created_at);
  if (month && row.commit_sha) {
    let set = agg.monthCommits.get(month);
    if (!set) {
      set = new Set();
      agg.monthCommits.set(month, set);
    }
    set.add(row.commit_sha);
  }

  if (row.repository_id) {
    let usage = agg.repoUsage.get(row.repository_id);
    if (!usage) {
      usage = { files: new Set(), commits: new Set(), lines: 0, lastTs: 0 };
      agg.repoUsage.set(row.repository_id, usage);
    }
    usage.files.add(row.path);
    if (row.commit_sha) usage.commits.add(row.commit_sha);
    usage.lines += lines;
    if (Number.isFinite(ts)) usage.lastTs = Math.max(usage.lastTs, ts);
  }
}

interface CoOccurrence {
  a: string;
  b: string;
  commits: number;
  affinity: number;
}

interface ClassificationResult {
  aggregates: Map<string, SkillAggregate>;
  coOccurrence: CoOccurrence[];
  ignoredFiles: number;
  unmatchedFiles: number;
}

function classifyEvidence(rows: FileChangeEvidenceRow[]): ClassificationResult {
  const startedAt = nowMs();
  const now = Date.now();

  log("classifying evidence against taxonomy — start", {
    fileChanges: rows.length,
    taxonomySize: SKILL_TAXONOMY.length,
  });

  const aggregates = new Map<string, SkillAggregate>();
  const commitSkills = new Map<string, Set<string>>();
  let ignoredFiles = 0;
  let unmatchedFiles = 0;
  let matchCount = 0;

  for (const row of rows) {
    if (isNoiseFile(row.path)) {
      ignoredFiles += 1;
      continue;
    }

    const matches = classifyRow(row);
    if (matches.size === 0) {
      unmatchedFiles += 1;
      continue;
    }

    for (const [skillId, match] of matches) {
      matchCount += 1;

      let agg = aggregates.get(skillId);
      if (!agg) {
        agg = newAggregate(skillId);
        aggregates.set(skillId, agg);
      }
      addToAggregate(agg, row, match, now);

      // Co-occurrence only from real (strong, non-implied, non-language)
      // evidence, otherwise every React file "co-occurs" with TypeScript.
      if (
        match.strength === 2 &&
        !match.implied &&
        row.commit_sha &&
        DEF_BY_ID.get(skillId)?.category !== "languages"
      ) {
        let set = commitSkills.get(row.commit_sha);
        if (!set) {
          set = new Set();
          commitSkills.set(row.commit_sha, set);
        }
        set.add(skillId);
      }
    }
  }

  const pairCounts = new Map<string, number>();
  for (const skills of commitSkills.values()) {
    if (skills.size < 2) continue;
    const ids = [...skills].sort();
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        const key = `${ids[i]}|${ids[j]}`;
        pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
      }
    }
  }

  const coOccurrence: CoOccurrence[] = [];
  for (const [key, commits] of pairCounts) {
    if (commits < MIN_COOCCURRENCE) continue;
    const [a, b] = key.split("|") as [string, string];
    const smaller = Math.min(
      aggregates.get(a)?.commitShas.size ?? commits,
      aggregates.get(b)?.commitShas.size ?? commits,
    );
    coOccurrence.push({
      a,
      b,
      commits,
      affinity: round(Math.min(1, commits / Math.max(smaller, 1))),
    });
  }
  coOccurrence.sort((x, y) => y.commits - x.commits);
  coOccurrence.splice(MAX_COOCCURRENCE_EDGES);

  log("classifying evidence against taxonomy — done", {
    fileChanges: rows.length,
    skillsMatched: aggregates.size,
    totalSkillHits: matchCount,
    ignoredFiles,
    unmatchedFiles,
    coOccurrenceEdges: coOccurrence.length,
    durationMs: elapsedMs(startedAt),
  });

  if (unmatchedFiles > 0) {
    log("some files matched no skill in the taxonomy", {
      unmatchedFiles,
      hint: "extend SKILL_TAXONOMY if these should be recognized",
    });
  }

  return { aggregates, coOccurrence, ignoredFiles, unmatchedFiles };
}

// ============================================================
// SCORING
// ============================================================

export interface ActivityPoint {
  month: string;
  count: number;
}

export interface SkillProfileEntry {
  skillId: string;
  skillName: string;
  categoryId: string;
  categoryName: string;
  depthScore: number;
  level: SkillLevel;
  filesTouched: number;
  strongFiles: number;
  commitsCount: number;
  reposCount: number;
  linesAdded: number;
  linesDeleted: number;
  activeDays: number;
  activeMonths: number;
  firstSeen: string;
  lastSeen: string;
  recencyDays: number;
  recentCommits: number;
  priorCommits: number;
  trend: SkillTrend;
  confidence: SkillConfidence;
  evidenceQuality: number;
  activity: ActivityPoint[];
}

function computeTrend(agg: SkillAggregate, now: number): SkillTrend {
  const daysSince = agg.lastSeenTs
    ? (now - agg.lastSeenTs) / DAY_MS
    : Number.POSITIVE_INFINITY;
  if (daysSince > DORMANT_AFTER_DAYS) return "dormant";

  const recent = agg.recentShas.size;
  const prior = agg.priorShas.size;

  if (recent === 0) return "cooling";
  if (recent >= 2 && recent >= prior * 1.3) return "rising";
  if (recent * 1.3 < prior) return "cooling";
  return "steady";
}

function computeConfidence(agg: SkillAggregate): SkillConfidence {
  const strong = agg.strongFilePaths.size;
  const commits = agg.commitShas.size;
  if (strong >= 10 && commits >= 5) return "high";
  if (strong >= 3 || commits >= 3) return "medium";
  return "low";
}

function computeDepth(agg: SkillAggregate): {
  score: number;
  quality: number;
} {
  const files = agg.filePaths.size;
  const strongFiles = agg.strongFilePaths.size;
  const weakFiles = Math.max(0, files - strongFiles);
  const weightedFiles = strongFiles + WEAK_WEIGHT * weakFiles;

  const volume =
    Math.min(Math.log10(agg.weightedLines + 1) / 4.2, 1) * SCORE_WEIGHTS.volume;

  const breadth =
    Math.sqrt(Math.min(weightedFiles / BREADTH_CAP_FILES, 1)) *
    SCORE_WEIGHTS.breadth;

  const commits =
    Math.sqrt(Math.min(agg.commitShas.size / COMMITS_CAP, 1)) *
    SCORE_WEIGHTS.commits;

  const repos =
    Math.min(agg.repositoryIds.size / REPOS_CAP, 1) * SCORE_WEIGHTS.repos;

  const spanDays = Math.max(
    0,
    Number.isFinite(agg.firstSeenTs)
      ? (agg.lastSeenTs - agg.firstSeenTs) / DAY_MS
      : 0,
  );
  const sustained =
    (0.6 * Math.min(agg.activeDayKeys.size / SUSTAIN_DAYS_CAP, 1) +
      0.4 * Math.min(spanDays / SUSTAIN_SPAN_CAP_DAYS, 1)) *
    SCORE_WEIGHTS.sustained;

  // Evidence quality: a skill proven only by language / path hints
  // can reach at most 60% of its raw score.
  const strongRatio = files > 0 ? strongFiles / files : 0;
  const quality = 0.6 + 0.4 * strongRatio;

  const raw = volume + breadth + commits + repos + sustained;
  const score = Math.max(0, Math.min(100, Math.round(raw * quality)));

  return { score, quality: round(quality) };
}

function activitySeries(agg: SkillAggregate): ActivityPoint[] {
  return [...agg.monthCommits.entries()]
    .map(([month, shas]) => ({ month, count: shas.size }))
    .sort((x, y) => x.month.localeCompare(y.month))
    .slice(-ACTIVITY_MONTHS);
}

function buildSkillProfile(
  aggregates: Map<string, SkillAggregate>,
): SkillProfileEntry[] {
  const startedAt = nowMs();
  log("scoring skill profile — start", { skillsToScore: aggregates.size });

  const now = Date.now();
  const entries: SkillProfileEntry[] = [];

  for (const agg of aggregates.values()) {
    const def = DEF_BY_ID.get(agg.skillId);
    if (!def) {
      log("skipping aggregate for unknown skill id (not in taxonomy)", {
        skillId: agg.skillId,
      });
      continue;
    }

    const category = CATEGORY_BY_ID.get(def.category);
    const { score, quality } = computeDepth(agg);
    const activity = activitySeries(agg);

    entries.push({
      skillId: def.id,
      skillName: def.name,
      categoryId: def.category,
      categoryName: category?.name ?? def.category,
      depthScore: score,
      level: levelForScore(score),
      filesTouched: agg.filePaths.size,
      strongFiles: agg.strongFilePaths.size,
      commitsCount: agg.commitShas.size,
      reposCount: agg.repositoryIds.size,
      linesAdded: agg.linesAdded,
      linesDeleted: agg.linesDeleted,
      activeDays: agg.activeDayKeys.size,
      activeMonths: agg.monthCommits.size,
      firstSeen: Number.isFinite(agg.firstSeenTs)
        ? new Date(agg.firstSeenTs).toISOString()
        : "",
      lastSeen: agg.lastSeenTs ? new Date(agg.lastSeenTs).toISOString() : "",
      recencyDays: agg.lastSeenTs
        ? Math.max(0, Math.round((now - agg.lastSeenTs) / DAY_MS))
        : -1,
      recentCommits: agg.recentShas.size,
      priorCommits: agg.priorShas.size,
      trend: computeTrend(agg, now),
      confidence: computeConfidence(agg),
      evidenceQuality: quality,
      activity,
    });
  }

  entries.sort((a, b) => b.depthScore - a.depthScore);

  log("scoring skill profile — done", {
    skillsScored: entries.length,
    durationMs: elapsedMs(startedAt),
    topSkills: entries.slice(0, 10).map((e) => ({
      skillId: e.skillId,
      depthScore: e.depthScore,
      level: e.level,
      trend: e.trend,
      confidence: e.confidence,
    })),
  });

  return entries;
}

// ============================================================
// GRAPH WRITES
// ============================================================

async function storeSkillCategories(graph: Graph): Promise<void> {
  const startedAt = nowMs();
  log("writing skill categories", { count: SKILL_CATEGORIES.length });

  await graph.query(
    `
    UNWIND $batch AS item
    MERGE (c:SkillCategory {id: item.id})
    SET c.name = item.name
    `,
    { params: { batch: asQueryParams(SKILL_CATEGORIES) } },
  );

  log("skill categories written", { durationMs: elapsedMs(startedAt) });
}

async function storeSkillDefinitions(graph: Graph): Promise<void> {
  const rows = SKILL_TAXONOMY.map((def) => ({
    id: def.id,
    name: def.name,
    category_id: def.category,
  }));

  await runBatches(
    graph,
    "skill definitions",
    `
    UNWIND $batch AS item
    MERGE (s:Skill {id: item.id})
    SET s.name = item.name,
        s.category_id = item.category_id

    WITH s, item
    MATCH (c:SkillCategory {id: item.category_id})
    MERGE (c)-[:CONTAINS]->(s)
    `,
    asQueryParams(rows),
  );

  // Static structure: (Skill)-[:IMPLIES]->(Skill) and ADJACENT_TO.
  // ADJACENT_TO is deliberately not RELATED_TO so it can never leak into
  // the Capability graph algorithms.
  const impliesRows = SKILL_TAXONOMY.flatMap((def) =>
    (def.implies ?? []).map((to) => ({ from: def.id, to })),
  );
  await runBatches(
    graph,
    "skill IMPLIES edges",
    `
    UNWIND $batch AS item
    MATCH (a:Skill {id: item.from})
    MATCH (b:Skill {id: item.to})
    MERGE (a)-[:IMPLIES]->(b)
    `,
    asQueryParams(impliesRows),
  );

  const adjacentRows = SKILL_TAXONOMY.flatMap((def) =>
    (def.related ?? []).map((to) => ({ from: def.id, to })),
  );
  await runBatches(
    graph,
    "skill ADJACENT_TO edges",
    `
    UNWIND $batch AS item
    MATCH (a:Skill {id: item.from})
    MATCH (b:Skill {id: item.to})
    MERGE (a)-[:ADJACENT_TO]->(b)
    `,
    asQueryParams(adjacentRows),
  );
}

/**
 * The taxonomy is static, so indexes, categories, skill definitions and the
 * IMPLIES / ADJACENT_TO edges are written once per process instead of on
 * every onboarding. A failed attempt is not cached, so the next run retries.
 */
let skillTaxonomyReady: Promise<void> | null = null;

function ensureSkillTaxonomy(graph: Graph): Promise<void> {
  if (!skillTaxonomyReady) {
    const pending: Promise<void> = (async () => {
      await ensureSkillIndexes(graph);
      await storeSkillCategories(graph);
      await storeSkillDefinitions(graph);
    })().catch((error) => {
      if (skillTaxonomyReady === pending) skillTaxonomyReady = null;
      throw error;
    });
    skillTaxonomyReady = pending;
  }
  return skillTaxonomyReady;
}

async function storeDeveloperSkills(
  graph: Graph,
  developerId: string,
  profile: SkillProfileEntry[],
  updatedAt: string,
): Promise<void> {
  const rows = profile.map((entry) => ({
    developer_id: developerId,
    skill_id: entry.skillId,
    depth_score: entry.depthScore,
    level: entry.level,
    files_touched: entry.filesTouched,
    strong_files: entry.strongFiles,
    commits_count: entry.commitsCount,
    repos_count: entry.reposCount,
    lines_added: entry.linesAdded,
    lines_deleted: entry.linesDeleted,
    active_days: entry.activeDays,
    active_months: entry.activeMonths,
    first_seen: entry.firstSeen,
    last_seen: entry.lastSeen,
    recency_days: entry.recencyDays,
    recent_commits: entry.recentCommits,
    prior_commits: entry.priorCommits,
    trend: entry.trend,
    confidence: entry.confidence,
    evidence_quality: entry.evidenceQuality,
    activity_json: JSON.stringify(entry.activity),
    updated_at: updatedAt,
  }));

  log("writing developer HAS_SKILL edges", {
    developerId,
    totalEdges: rows.length,
    updatedAt,
  });

  await runBatches(
    graph,
    "developer HAS_SKILL edges",
    `
    UNWIND $batch AS item
    MATCH (d:Developer {id: item.developer_id})
    MATCH (s:Skill {id: item.skill_id})
    MERGE (d)-[r:HAS_SKILL]->(s)
    SET
      r.depth_score = item.depth_score,
      r.level = item.level,
      r.files_touched = item.files_touched,
      r.strong_files = item.strong_files,
      r.commits_count = item.commits_count,
      r.repos_count = item.repos_count,
      r.lines_added = item.lines_added,
      r.lines_deleted = item.lines_deleted,
      r.active_days = item.active_days,
      r.active_months = item.active_months,
      r.first_seen = item.first_seen,
      r.last_seen = item.last_seen,
      r.recency_days = item.recency_days,
      r.recent_commits = item.recent_commits,
      r.prior_commits = item.prior_commits,
      r.trend = item.trend,
      r.confidence = item.confidence,
      r.evidence_quality = item.evidence_quality,
      r.activity_json = item.activity_json,
      r.updated_at = item.updated_at
    `,
    asQueryParams(rows),
  );

  // Skills no longer supported by current evidence must disappear.
  await graph.query(
    `
    MATCH (d:Developer {id: $developer_id})-[r:HAS_SKILL]->(:Skill)
    WHERE r.updated_at IS NULL OR r.updated_at <> $updated_at
    DELETE r
    `,
    { params: { developer_id: developerId, updated_at: updatedAt } },
  );
}

async function storeSkillUsage(
  graph: Graph,
  aggregates: Map<string, SkillAggregate>,
  updatedAt: string,
): Promise<void> {
  const rows: QueryParamObject[] = [];

  for (const agg of aggregates.values()) {
    for (const [repositoryId, usage] of agg.repoUsage) {
      rows.push({
        skill_id: agg.skillId,
        repository_id: repositoryId,
        files: usage.files.size,
        commits: usage.commits.size,
        lines: usage.lines,
        last_seen: usage.lastTs ? new Date(usage.lastTs).toISOString() : "",
        updated_at: updatedAt,
      });
    }
  }

  await runBatches(
    graph,
    "skill USED_IN edges",
    `
    UNWIND $batch AS item
    MATCH (s:Skill {id: item.skill_id})
    MATCH (r:Repository {id: item.repository_id})
    MERGE (s)-[u:USED_IN]->(r)
    SET u.files = item.files,
        u.commits = item.commits,
        u.lines = item.lines,
        u.last_seen = item.last_seen,
        u.updated_at = item.updated_at
    `,
    rows,
  );

  await graph.query(
    `
    MATCH (:Skill)-[u:USED_IN]->(:Repository)
    WHERE u.updated_at IS NULL OR u.updated_at <> $updated_at
    DELETE u
    `,
    { params: { updated_at: updatedAt } },
  );
}

async function storeCoOccurrence(
  graph: Graph,
  edges: CoOccurrence[],
  updatedAt: string,
): Promise<void> {
  await runBatches(
    graph,
    "skill CO_OCCURS edges",
    `
    UNWIND $batch AS item
    MATCH (a:Skill {id: item.a})
    MATCH (b:Skill {id: item.b})
    MERGE (a)-[r:CO_OCCURS]->(b)
    SET r.commits = item.commits,
        r.affinity = item.affinity,
        r.updated_at = item.updated_at
    `,
    asQueryParams(edges.map((edge) => ({ ...edge, updated_at: updatedAt }))),
  );

  await graph.query(
    `
    MATCH (:Skill)-[r:CO_OCCURS]->(:Skill)
    WHERE r.updated_at IS NULL OR r.updated_at <> $updated_at
    DELETE r
    `,
    { params: { updated_at: updatedAt } },
  );
}

// ============================================================
// PUBLIC API
// ============================================================

export interface SkillAnalysisResult {
  developerId: string;
  filesAnalyzed: number;
  filesIgnored: number;
  skillsFound: number;
  profile: SkillProfileEntry[];
}

/**
 * Analyze every FileChange authored by this developer, classify it against
 * SKILL_TAXONOMY, score depth per skill, and persist:
 *
 *   (Developer)-[:HAS_SKILL {score, level, trend, confidence, ...}]->(Skill)
 *   (SkillCategory)-[:CONTAINS]->(Skill)
 *   (Skill)-[:IMPLIES]->(Skill)           static
 *   (Skill)-[:ADJACENT_TO]->(Skill)       static
 *   (Skill)-[:CO_OCCURS {commits}]->(Skill)   from this developer's commits
 *   (Skill)-[:USED_IN {files, commits}]->(Repository)
 *
 * Safe to re-run: everything is MERGE/SET, and edges not produced by the
 * current run are removed.
 */
export async function analyzeDeveloperSkills(
  graph: Graph,
  developerId: string,
  onProgress: ProgressFn = () => {},
): Promise<SkillAnalysisResult> {
  if (!developerId) {
    throw new Error("Missing developerId");
  }

  const runStartedAt = nowMs();
  log("=== skill graph build: START ===", { developerId });

  try {
    await ensureSkillTaxonomy(graph);

    onProgress("skill_analysis_start", { developerId });

    const rows = await fetchFileChangeEvidence(graph, developerId, onProgress);

    onProgress("skill_evidence_loaded", { files: rows.length });

    if (rows.length === 0) {
      log(
        "no FileChange evidence found for developer — skill graph will be empty",
        { developerId },
      );
    }

    const { aggregates, coOccurrence, ignoredFiles } = classifyEvidence(rows);
    const profile = buildSkillProfile(aggregates);

    onProgress("skill_classified", {
      skillsFound: profile.length,
      filesIgnored: ignoredFiles,
    });

    const updatedAt = new Date().toISOString();

    await storeDeveloperSkills(graph, developerId, profile, updatedAt);

    onProgress("skill_relationships", { coOccurrence: coOccurrence.length });

    await storeSkillUsage(graph, aggregates, updatedAt);
    await storeCoOccurrence(graph, coOccurrence, updatedAt);

    onProgress("skill_analysis_complete", {
      developerId,
      filesAnalyzed: rows.length - ignoredFiles,
      filesIgnored: ignoredFiles,
      skillsFound: profile.length,
    });

    log("=== skill graph build: COMPLETE ===", {
      developerId,
      filesAnalyzed: rows.length,
      filesIgnored: ignoredFiles,
      skillsFound: profile.length,
      totalDurationMs: elapsedMs(runStartedAt),
      levelBreakdown: profile.reduce<Record<string, number>>((acc, e) => {
        acc[e.level] = (acc[e.level] ?? 0) + 1;
        return acc;
      }, {}),
      trendBreakdown: profile.reduce<Record<string, number>>((acc, e) => {
        acc[e.trend] = (acc[e.trend] ?? 0) + 1;
        return acc;
      }, {}),
    });

    return {
      developerId,
      filesAnalyzed: rows.length - ignoredFiles,
      filesIgnored: ignoredFiles,
      skillsFound: profile.length,
      profile,
    };
  } catch (error) {
    logError("=== skill graph build: FAILED ===", error);
    log("skill graph build failure context", {
      developerId,
      durationMs: elapsedMs(runStartedAt),
    });
    throw error;
  }
}

// ============================================================
// READ API — grouped by category, ready for a UI
// ============================================================

function parseActivity(value: unknown): ActivityPoint[] {
  const raw = safeString(value);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((p) => ({
        month: safeString(p?.month),
        count: safeNumber(p?.count),
      }))
      .filter((p) => /^\d{4}-\d{2}$/.test(p.month));
  } catch {
    return [];
  }
}

export interface CategorySkillGroup {
  categoryId: string;
  categoryName: string;
  /** Mean depth score of the category's top 3 skills. */
  categoryScore: number;
  skills: Array<{
    skillId: string;
    skillName: string;
    depthScore: number;
    level: SkillLevel;
    filesTouched: number;
    strongFiles: number;
    commitsCount: number;
    reposCount: number;
    linesAdded: number;
    linesDeleted: number;
    activeDays: number;
    firstSeen: string;
    lastSeen: string;
    recencyDays: number;
    trend: SkillTrend;
    confidence: SkillConfidence;
    evidenceQuality: number;
    activity: ActivityPoint[];
  }>;
}

export async function getDeveloperSkillProfile(
  graph: Graph,
  developerId: string,
): Promise<CategorySkillGroup[]> {
  const result = await graph.query(
    `
    MATCH (d:Developer {id: $developer_id})-[r:HAS_SKILL]->(s:Skill)<-[:CONTAINS]-(c:SkillCategory)
    RETURN
      c.id AS category_id,
      c.name AS category_name,
      s.id AS skill_id,
      s.name AS skill_name,
      r.depth_score AS depth_score,
      r.level AS level,
      r.files_touched AS files_touched,
      r.strong_files AS strong_files,
      r.commits_count AS commits_count,
      r.repos_count AS repos_count,
      r.lines_added AS lines_added,
      r.lines_deleted AS lines_deleted,
      r.active_days AS active_days,
      r.first_seen AS first_seen,
      r.last_seen AS last_seen,
      r.recency_days AS recency_days,
      r.trend AS trend,
      r.confidence AS confidence,
      r.evidence_quality AS evidence_quality,
      r.activity_json AS activity_json
    ORDER BY c.name, r.depth_score DESC
    `,
    { params: { developer_id: developerId } },
  );

  const rows = (result.data ?? []) as AnyObject[];

  const groups = new Map<string, CategorySkillGroup>();

  for (const row of rows) {
    const categoryId = safeString(row.category_id);

    let group = groups.get(categoryId);
    if (!group) {
      group = {
        categoryId,
        categoryName: safeString(row.category_name),
        categoryScore: 0,
        skills: [],
      };
      groups.set(categoryId, group);
    }

    group.skills.push({
      skillId: safeString(row.skill_id),
      skillName: safeString(row.skill_name),
      depthScore: safeNumber(row.depth_score),
      level: (safeString(row.level) || "novice") as SkillLevel,
      filesTouched: safeNumber(row.files_touched),
      strongFiles: safeNumber(row.strong_files),
      commitsCount: safeNumber(row.commits_count),
      reposCount: safeNumber(row.repos_count),
      linesAdded: safeNumber(row.lines_added),
      linesDeleted: safeNumber(row.lines_deleted),
      activeDays: safeNumber(row.active_days),
      firstSeen: safeString(row.first_seen),
      lastSeen: safeString(row.last_seen),
      recencyDays: row.recency_days == null ? -1 : safeNumber(row.recency_days),
      trend: (safeString(row.trend) || "steady") as SkillTrend,
      confidence: (safeString(row.confidence) || "low") as SkillConfidence,
      evidenceQuality: safeNumber(row.evidence_quality),
      activity: parseActivity(row.activity_json),
    });
  }

  for (const group of groups.values()) {
    const top = group.skills
      .map((s) => s.depthScore)
      .sort((a, b) => b - a)
      .slice(0, 3);
    group.categoryScore = top.length
      ? Math.round(top.reduce((sum, v) => sum + v, 0) / top.length)
      : 0;
  }

  return Array.from(groups.values());
}

// ============================================================
// SKILL GRAPH (nodes + edges for a visual graph / 3D view)
// ============================================================

export interface SkillGraphNode {
  id: string;
  type: "category" | "skill" | "repository";
  label: string;
  categoryId?: string;
  score?: number;
  level?: SkillLevel;
  trend?: SkillTrend;
  confidence?: SkillConfidence;
  commits?: number;
}

export interface SkillGraphEdge {
  source: string;
  target: string;
  type: "contains" | "co_occurs" | "implies" | "used_in";
  weight: number;
}

export interface SkillGraphView {
  nodes: SkillGraphNode[];
  edges: SkillGraphEdge[];
}

export async function getSkillGraph(
  graph: Graph,
  developerId: string,
  options: { includeRepositories?: boolean } = {},
): Promise<SkillGraphView> {
  const params = { developer_id: developerId };

  const [skillRes, coRes, impliesRes, repoRes] = await Promise.all([
    graph.query(
      `
      MATCH (d:Developer {id: $developer_id})-[r:HAS_SKILL]->(s:Skill)<-[:CONTAINS]-(c:SkillCategory)
      RETURN s.id AS id, s.name AS name, c.id AS category_id, c.name AS category_name,
             r.depth_score AS score, r.level AS level, r.trend AS trend,
             r.confidence AS confidence, r.commits_count AS commits
      `,
      { params },
    ),
    graph.query(
      `
      MATCH (d:Developer {id: $developer_id})-[:HAS_SKILL]->(a:Skill),
            (d)-[:HAS_SKILL]->(b:Skill),
            (a)-[r:CO_OCCURS]->(b)
      RETURN a.id AS a, b.id AS b, r.commits AS commits, r.affinity AS affinity
      `,
      { params },
    ),
    graph.query(
      `
      MATCH (d:Developer {id: $developer_id})-[:HAS_SKILL]->(a:Skill),
            (d)-[:HAS_SKILL]->(b:Skill),
            (a)-[:IMPLIES]->(b)
      RETURN a.id AS a, b.id AS b
      `,
      { params },
    ),
    options.includeRepositories
      ? graph.query(
          `
          MATCH (d:Developer {id: $developer_id})-[:HAS_SKILL]->(s:Skill)-[u:USED_IN]->(r:Repository)
          RETURN s.id AS skill_id, r.id AS repository_id,
                 coalesce(r.full_name, r.name, "") AS name,
                 u.files AS files, u.commits AS commits
          ORDER BY u.commits DESC
          LIMIT 120
          `,
          { params },
        )
      : Promise.resolve({ data: [] as AnyObject[] }),
  ]);

  const nodes = new Map<string, SkillGraphNode>();
  const edges: SkillGraphEdge[] = [];

  for (const row of (skillRes.data ?? []) as AnyObject[]) {
    const categoryId = safeString(row.category_id);
    const categoryNodeId = `category:${categoryId}`;
    const skillNodeId = `skill:${safeString(row.id)}`;

    if (!nodes.has(categoryNodeId)) {
      nodes.set(categoryNodeId, {
        id: categoryNodeId,
        type: "category",
        label: safeString(row.category_name),
        categoryId,
      });
    }

    nodes.set(skillNodeId, {
      id: skillNodeId,
      type: "skill",
      label: safeString(row.name),
      categoryId,
      score: safeNumber(row.score),
      level: (safeString(row.level) || "novice") as SkillLevel,
      trend: (safeString(row.trend) || "steady") as SkillTrend,
      confidence: (safeString(row.confidence) || "low") as SkillConfidence,
      commits: safeNumber(row.commits),
    });

    edges.push({
      source: categoryNodeId,
      target: skillNodeId,
      type: "contains",
      weight: 1,
    });
  }

  for (const row of (coRes.data ?? []) as AnyObject[]) {
    edges.push({
      source: `skill:${safeString(row.a)}`,
      target: `skill:${safeString(row.b)}`,
      type: "co_occurs",
      weight: safeNumber(row.affinity) || 0.1,
    });
  }

  for (const row of (impliesRes.data ?? []) as AnyObject[]) {
    edges.push({
      source: `skill:${safeString(row.a)}`,
      target: `skill:${safeString(row.b)}`,
      type: "implies",
      weight: 0.5,
    });
  }

  for (const row of (repoRes.data ?? []) as AnyObject[]) {
    const repoNodeId = `repo:${safeString(row.repository_id)}`;
    if (!nodes.has(repoNodeId)) {
      nodes.set(repoNodeId, {
        id: repoNodeId,
        type: "repository",
        label: safeString(row.name),
      });
    }
    edges.push({
      source: `skill:${safeString(row.skill_id)}`,
      target: repoNodeId,
      type: "used_in",
      weight: safeNumber(row.commits),
    });
  }

  return { nodes: [...nodes.values()], edges };
}

// ============================================================
// INSIGHTS (derived from the profile, no extra queries)
// ============================================================

export interface InsightSkill {
  skillId: string;
  skillName: string;
  categoryName: string;
  depthScore: number;
  level: SkillLevel;
  trend: SkillTrend;
  confidence: SkillConfidence;
}

export interface SkillInsights {
  headline: {
    totalSkills: number;
    advancedOrExpert: number;
    averageScore: number;
    strongestCategory: string;
    freshestSkill: string;
  };
  strengths: InsightSkill[];
  rising: InsightSkill[];
  cooling: InsightSkill[];
  thinEvidence: InsightSkill[];
  adjacent: Array<{
    skillId: string;
    skillName: string;
    categoryName: string;
    because: string[];
  }>;
  categoryBalance: Array<{
    categoryId: string;
    categoryName: string;
    score: number;
    skills: number;
  }>;
}

export function buildSkillInsights(
  groups: CategorySkillGroup[],
): SkillInsights {
  const all: InsightSkill[] = groups.flatMap((group) =>
    group.skills.map((s) => ({
      skillId: s.skillId,
      skillName: s.skillName,
      categoryName: group.categoryName,
      depthScore: s.depthScore,
      level: s.level,
      trend: s.trend,
      confidence: s.confidence,
    })),
  );

  const byScore = [...all].sort((a, b) => b.depthScore - a.depthScore);
  const have = new Set(all.map((s) => s.skillId));

  // "What next": skills adjacent to things the developer is already
  // proficient at, but which never show up in their code.
  const adjacency = new Map<string, Set<string>>();
  for (const skill of all) {
    if (skill.depthScore < 36) continue;
    for (const relatedId of DEF_BY_ID.get(skill.skillId)?.related ?? []) {
      if (have.has(relatedId)) continue;
      const set = adjacency.get(relatedId) ?? new Set<string>();
      set.add(skill.skillName);
      adjacency.set(relatedId, set);
    }
  }

  const adjacent = [...adjacency.entries()]
    .map(([skillId, because]) => {
      const def = DEF_BY_ID.get(skillId);
      return {
        skillId,
        skillName: def?.name ?? skillId,
        categoryName: CATEGORY_BY_ID.get(def?.category ?? "")?.name ?? "",
        because: [...because].slice(0, 4),
      };
    })
    .sort((a, b) => b.because.length - a.because.length)
    .slice(0, 8);

  const categoryBalance = groups
    .map((g) => ({
      categoryId: g.categoryId,
      categoryName: g.categoryName,
      score: g.categoryScore,
      skills: g.skills.length,
    }))
    .sort((a, b) => b.score - a.score);

  const freshest = [...all]
    .filter((s) => s.trend === "rising" || s.trend === "steady")
    .sort((a, b) => b.depthScore - a.depthScore)[0];

  return {
    headline: {
      totalSkills: all.length,
      advancedOrExpert: all.filter(
        (s) => s.level === "advanced" || s.level === "expert",
      ).length,
      averageScore: all.length
        ? Math.round(all.reduce((sum, s) => sum + s.depthScore, 0) / all.length)
        : 0,
      strongestCategory: categoryBalance[0]?.categoryName ?? "",
      freshestSkill: freshest?.skillName ?? "",
    },
    strengths: byScore
      .filter((s) => s.confidence !== "low" && s.depthScore >= 36)
      .slice(0, 6),
    rising: byScore.filter((s) => s.trend === "rising").slice(0, 6),
    cooling: byScore
      .filter(
        (s) =>
          (s.trend === "cooling" || s.trend === "dormant") &&
          s.depthScore >= 36,
      )
      .slice(0, 6),
    thinEvidence: byScore
      .filter((s) => s.confidence === "low" && s.depthScore >= 16)
      .slice(0, 6),
    adjacent,
    categoryBalance,
  };
}

export async function getSkillInsights(
  graph: Graph,
  developerId: string,
): Promise<SkillInsights> {
  return buildSkillInsights(await getDeveloperSkillProfile(graph, developerId));
}

// ============================================================
// SINGLE-SKILL DETAIL + EVIDENCE ("proof")
//
// The stored HAS_SKILL edge carries the aggregate numbers. For a detail
// page we also re-run the same classification for the one requested skill
// to return concrete files (diverse across repositories), a monthly
// timeline, a per-repository breakdown, and graph neighbours.
// ============================================================

export interface SkillProofItem {
  path: string;
  repositoryId: string;
  repositoryName: string;
  commitSha: string;
  commitUrl: string;
  additions: number;
  deletions: number;
  createdAt: string;
  strength: "strong" | "weak";
  implied: boolean;
}

export interface SkillDetail {
  skillId: string;
  skillName: string;
  categoryId: string;
  categoryName: string;
  depthScore: number;
  level: SkillLevel;
  filesTouched: number;
  strongFiles: number;
  commitsCount: number;
  reposCount: number;
  linesAdded: number;
  linesDeleted: number;
  activeDays: number;
  firstSeen: string;
  lastSeen: string;
  recencyDays: number;
  recentCommits: number;
  priorCommits: number;
  trend: SkillTrend;
  confidence: SkillConfidence;
  evidenceQuality: number;
  activity: ActivityPoint[];
  repositories: Array<{
    repositoryId: string;
    name: string;
    files: number;
    commits: number;
    lines: number;
  }>;
  related: Array<{
    skillId: string;
    skillName: string;
    commits: number;
    affinity: number;
  }>;
  implies: Array<{ skillId: string; skillName: string }>;
  impliedBy: Array<{ skillId: string; skillName: string }>;
  nextSteps: Array<{ skillId: string; skillName: string }>;
  proof: SkillProofItem[];
}

async function fetchStoredSkillMetrics(
  graph: Graph,
  developerId: string,
  skillId: string,
): Promise<AnyObject | null> {
  const result = await graph.query(
    `
    MATCH (d:Developer {id: $developer_id})-[r:HAS_SKILL]->(s:Skill {id: $skill_id})
    MATCH (c:SkillCategory)-[:CONTAINS]->(s)
    RETURN
      s.id AS skill_id,
      s.name AS skill_name,
      c.id AS category_id,
      c.name AS category_name,
      r.depth_score AS depth_score,
      r.level AS level,
      r.files_touched AS files_touched,
      r.strong_files AS strong_files,
      r.commits_count AS commits_count,
      r.repos_count AS repos_count,
      r.lines_added AS lines_added,
      r.lines_deleted AS lines_deleted,
      r.active_days AS active_days,
      r.first_seen AS first_seen,
      r.last_seen AS last_seen,
      r.recency_days AS recency_days,
      r.recent_commits AS recent_commits,
      r.prior_commits AS prior_commits,
      r.trend AS trend,
      r.confidence AS confidence,
      r.evidence_quality AS evidence_quality,
      r.activity_json AS activity_json
    `,
    { params: { developer_id: developerId, skill_id: skillId } },
  );

  const rows = (result.data ?? []) as AnyObject[];
  return rows[0] ?? null;
}

async function fetchRepositoryNames(
  graph: Graph,
  ids: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (ids.length === 0) return out;

  try {
    const result = await graph.query(
      `
      MATCH (r:Repository)
      WHERE r.id IN $ids
      RETURN r.id AS id, coalesce(r.full_name, r.name, "") AS name
      `,
      { params: { ids } },
    );
    for (const row of (result.data ?? []) as AnyObject[]) {
      out.set(safeString(row.id), safeString(row.name));
    }
  } catch (error) {
    logError("repository name lookup failed", error);
  }
  return out;
}

async function fetchCoOccurring(
  graph: Graph,
  developerId: string,
  skillId: string,
): Promise<SkillDetail["related"]> {
  try {
    const result = await graph.query(
      `
      MATCH (d:Developer {id: $developer_id})-[:HAS_SKILL]->(s:Skill {id: $skill_id}),
            (d)-[:HAS_SKILL]->(o:Skill),
            (s)-[r:CO_OCCURS]-(o)
      RETURN o.id AS id, o.name AS name, r.commits AS commits, r.affinity AS affinity
      ORDER BY r.commits DESC
      LIMIT 8
      `,
      { params: { developer_id: developerId, skill_id: skillId } },
    );
    return ((result.data ?? []) as AnyObject[]).map((row) => ({
      skillId: safeString(row.id),
      skillName: safeString(row.name),
      commits: safeNumber(row.commits),
      affinity: safeNumber(row.affinity),
    }));
  } catch (error) {
    logError("co-occurrence lookup failed", error);
    return [];
  }
}

async function fetchOwnedSkillIds(
  graph: Graph,
  developerId: string,
): Promise<Set<string>> {
  try {
    const result = await graph.query(
      `MATCH (:Developer {id: $developer_id})-[:HAS_SKILL]->(s:Skill) RETURN s.id AS id`,
      { params: { developer_id: developerId } },
    );
    return new Set(
      ((result.data ?? []) as AnyObject[]).map((row) => safeString(row.id)),
    );
  } catch (error) {
    logError("owned skills lookup failed", error);
    return new Set();
  }
}

const skillRef = (id: string) => ({
  skillId: id,
  skillName: DEF_BY_ID.get(id)?.name ?? id,
});

/**
 * Get the full detail + evidence for one skill for one developer.
 * Returns null if the developer has never demonstrated this skill
 * (no HAS_SKILL edge — i.e. analyzeDeveloperSkills found no hits).
 */
export async function getSkillDetail(
  graph: Graph,
  developerId: string,
  skillId: string,
  proofLimit = 8,
): Promise<SkillDetail | null> {
  const def = DEF_BY_ID.get(skillId);
  if (!def) {
    log("getSkillDetail: unknown skillId (not in taxonomy)", { skillId });
    return null;
  }

  const metrics = await fetchStoredSkillMetrics(graph, developerId, skillId);
  if (!metrics) {
    log("getSkillDetail: no HAS_SKILL edge for developer + skill", {
      developerId,
      skillId,
    });
    return null;
  }

  const [rows, related, owned] = await Promise.all([
    fetchFileChangeEvidence(graph, developerId, () => {}),
    fetchCoOccurring(graph, developerId, skillId),
    fetchOwnedSkillIds(graph, developerId),
  ]);

  const matched = rows
    .filter((row) => !isNoiseFile(row.path))
    .map((row) => ({ row, match: classifyRow(row).get(skillId) }))
    .filter(
      (item): item is { row: FileChangeEvidenceRow; match: RowMatch } =>
        item.match !== undefined,
    );

  // Strong, non-implied evidence first, then biggest change.
  const rank = (m: RowMatch) => (m.implied ? 0 : m.strength);
  const lines = (r: FileChangeEvidenceRow) =>
    Math.min(r.additions + r.deletions, MAX_LINES_PER_CHANGE);

  const sorted = [...matched].sort(
    (a, b) => rank(b.match) - rank(a.match) || lines(b.row) - lines(a.row),
  );

  // Diversify: best change per repository first, then fill by rank.
  const picked: typeof sorted = [];
  const usedRepos = new Set<string>();
  const usedPaths = new Set<string>();
  for (const item of sorted) {
    if (picked.length >= proofLimit) break;
    if (usedRepos.has(item.row.repository_id)) continue;
    usedRepos.add(item.row.repository_id);
    usedPaths.add(`${item.row.repository_id}:${item.row.path}`);
    picked.push(item);
  }
  for (const item of sorted) {
    if (picked.length >= proofLimit) break;
    const key = `${item.row.repository_id}:${item.row.path}`;
    if (usedPaths.has(key)) continue;
    usedPaths.add(key);
    picked.push(item);
  }
  picked.sort(
    (a, b) => rank(b.match) - rank(a.match) || lines(b.row) - lines(a.row),
  );

  // Fresh per-repo and per-month breakdown from the same evidence.
  const repoStats = new Map<
    string,
    { files: Set<string>; commits: Set<string>; lines: number }
  >();
  const monthCommits = new Map<string, Set<string>>();
  for (const { row } of matched) {
    const stats = repoStats.get(row.repository_id) ?? {
      files: new Set<string>(),
      commits: new Set<string>(),
      lines: 0,
    };
    stats.files.add(row.path);
    if (row.commit_sha) stats.commits.add(row.commit_sha);
    stats.lines += row.additions + row.deletions;
    repoStats.set(row.repository_id, stats);

    const month = monthKey(row.created_at);
    if (month && row.commit_sha) {
      const set = monthCommits.get(month) ?? new Set<string>();
      set.add(row.commit_sha);
      monthCommits.set(month, set);
    }
  }

  const repoIds = [...repoStats.keys()].filter(Boolean);
  const repoNames = await fetchRepositoryNames(graph, repoIds);

  const repositories = [...repoStats.entries()]
    .map(([repositoryId, stats]) => ({
      repositoryId,
      name: repoNames.get(repositoryId) ?? "",
      files: stats.files.size,
      commits: stats.commits.size,
      lines: stats.lines,
    }))
    .sort((a, b) => b.commits - a.commits || b.lines - a.lines)
    .slice(0, 10);

  const proof: SkillProofItem[] = picked.map(({ row, match }) => {
    const repoName = repoNames.get(row.repository_id) ?? "";
    return {
      path: row.path,
      repositoryId: row.repository_id,
      repositoryName: repoName,
      commitSha: row.commit_sha,
      commitUrl:
        repoName && row.commit_sha
          ? `https://github.com/${repoName}/commit/${row.commit_sha}`
          : "",
      additions: row.additions,
      deletions: row.deletions,
      createdAt: row.created_at,
      strength: match.strength === 2 ? "strong" : "weak",
      implied: match.implied,
    };
  });

  const activity: ActivityPoint[] = [...monthCommits.entries()]
    .map(([month, shas]) => ({ month, count: shas.size }))
    .sort((a, b) => a.month.localeCompare(b.month))
    .slice(-24);

  const nextSteps = (def.related ?? [])
    .filter((id) => !owned.has(id))
    .map(skillRef);

  log("getSkillDetail: resolved", {
    developerId,
    skillId,
    proofItems: proof.length,
    repositories: repositories.length,
    related: related.length,
  });

  return {
    skillId: safeString(metrics.skill_id),
    skillName: safeString(metrics.skill_name),
    categoryId: safeString(metrics.category_id),
    categoryName: safeString(metrics.category_name),
    depthScore: safeNumber(metrics.depth_score),
    level: (safeString(metrics.level) || "novice") as SkillLevel,
    filesTouched: safeNumber(metrics.files_touched),
    strongFiles: safeNumber(metrics.strong_files),
    commitsCount: safeNumber(metrics.commits_count),
    reposCount: safeNumber(metrics.repos_count),
    linesAdded: safeNumber(metrics.lines_added),
    linesDeleted: safeNumber(metrics.lines_deleted),
    activeDays: safeNumber(metrics.active_days),
    firstSeen: safeString(metrics.first_seen),
    lastSeen: safeString(metrics.last_seen),
    recencyDays:
      metrics.recency_days == null ? -1 : safeNumber(metrics.recency_days),
    recentCommits: safeNumber(metrics.recent_commits),
    priorCommits: safeNumber(metrics.prior_commits),
    trend: (safeString(metrics.trend) || "steady") as SkillTrend,
    confidence: (safeString(metrics.confidence) || "low") as SkillConfidence,
    evidenceQuality: safeNumber(metrics.evidence_quality),
    activity: activity.length ? activity : parseActivity(metrics.activity_json),
    repositories,
    related,
    implies: (def.implies ?? []).map(skillRef),
    impliedBy: (IMPLIED_BY.get(skillId) ?? []).map(skillRef),
    nextSteps,
    proof,
  };
}
