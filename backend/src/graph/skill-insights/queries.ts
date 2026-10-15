import type { Graph } from "../../db/falkordb.js";




import { Domain as _constants } from './constants.js';
import { Domain as _helpers } from './helpers.js';
import { Domain as _readers } from './readers.js';
import { Domain as _types } from './types.js';
import { Domain as _writers } from './writers.js';

export namespace Domain {
import LOG_PREFIX = _constants.LOG_PREFIX;
import SKILL_CATEGORIES = _constants.SKILL_CATEGORIES;
import DB_BATCH_SIZE = _constants.DB_BATCH_SIZE;
import log = _helpers.log;
import logError = _helpers.logError;
import nowMs = _helpers.nowMs;
import elapsedMs = _helpers.elapsedMs;
import language = _helpers.language;
import IMPLIES = _helpers.IMPLIES;
import RELATED = _helpers.RELATED;
import DEF_BY_ID = _helpers.DEF_BY_ID;
import CATEGORY_BY_ID = _helpers.CATEGORY_BY_ID;
import IMPLIED_BY = _helpers.IMPLIED_BY;
import DAY_MS = _helpers.DAY_MS;
import SCORE_WEIGHTS = _helpers.SCORE_WEIGHTS;
import BREADTH_CAP_FILES = _helpers.BREADTH_CAP_FILES;
import COMMITS_CAP = _helpers.COMMITS_CAP;
import REPOS_CAP = _helpers.REPOS_CAP;
import SUSTAIN_DAYS_CAP = _helpers.SUSTAIN_DAYS_CAP;
import SUSTAIN_SPAN_CAP_DAYS = _helpers.SUSTAIN_SPAN_CAP_DAYS;
import WEAK_WEIGHT = _helpers.WEAK_WEIGHT;
import MAX_LINES_PER_CHANGE = _helpers.MAX_LINES_PER_CHANGE;
import MAX_CODE_SCAN_CHARS = _helpers.MAX_CODE_SCAN_CHARS;
import RECENT_WINDOW_DAYS = _helpers.RECENT_WINDOW_DAYS;
import DORMANT_AFTER_DAYS = _helpers.DORMANT_AFTER_DAYS;
import MIN_COOCCURRENCE = _helpers.MIN_COOCCURRENCE;
import MAX_COOCCURRENCE_EDGES = _helpers.MAX_COOCCURRENCE_EDGES;
import ACTIVITY_MONTHS = _helpers.ACTIVITY_MONTHS;
import levelForScore = _helpers.levelForScore;
import safeString = _helpers.safeString;
import safeNumber = _helpers.safeNumber;
import round = _helpers.round;
import chunkArray = _helpers.chunkArray;
import asQueryParams = _helpers.asQueryParams;
import SAFE_IDENTIFIER = _helpers.SAFE_IDENTIFIER;
import assertSafeIdentifier = _helpers.assertSafeIdentifier;
import dayKey = _helpers.dayKey;
import monthKey = _helpers.monthKey;
import runBatches = _helpers.runBatches;
import SKILL_INDEXES = _helpers.SKILL_INDEXES;
import NOISE_PATH_PATTERNS = _helpers.NOISE_PATH_PATTERNS;
import skillSignal = _helpers.skillSignal;
import matchesSkill = _helpers.matchesSkill;
import classifyRow = _helpers.classifyRow;
import newAggregate = _helpers.newAggregate;
import addToAggregate = _helpers.addToAggregate;
import classifyEvidence = _helpers.classifyEvidence;
import computeTrend = _helpers.computeTrend;
import computeConfidence = _helpers.computeConfidence;
import computeDepth = _helpers.computeDepth;
import activitySeries = _helpers.activitySeries;
import analyzeDeveloperSkills = _helpers.analyzeDeveloperSkills;
import parseActivity = _helpers.parseActivity;
import skillRef = _helpers.skillRef;
import FETCH_PAGE_SIZE = _readers.FETCH_PAGE_SIZE;
import fetchFileChangeEvidence = _readers.fetchFileChangeEvidence;
import isNoiseFile = _readers.isNoiseFile;
import buildSkillProfile = _readers.buildSkillProfile;
import getDeveloperSkillProfile = _readers.getDeveloperSkillProfile;
import getSkillGraph = _readers.getSkillGraph;
import buildSkillInsights = _readers.buildSkillInsights;
import getSkillInsights = _readers.getSkillInsights;
import fetchStoredSkillMetrics = _readers.fetchStoredSkillMetrics;
import fetchRepositoryNames = _readers.fetchRepositoryNames;
import fetchCoOccurring = _readers.fetchCoOccurring;
import fetchOwnedSkillIds = _readers.fetchOwnedSkillIds;
import getSkillDetail = _readers.getSkillDetail;
import AnyObject = _types.AnyObject;
import ProgressFn = _types.ProgressFn;
import SkillDefinition = _types.SkillDefinition;
import SkillCategoryDefinition = _types.SkillCategoryDefinition;
import SkillLevel = _types.SkillLevel;
import SkillTrend = _types.SkillTrend;
import SkillConfidence = _types.SkillConfidence;
import QueryPrimitive = _types.QueryPrimitive;
import QueryParamObject = _types.QueryParamObject;
import FileChangeEvidenceRow = _types.FileChangeEvidenceRow;
import SkillEvidenceLike = _types.SkillEvidenceLike;
import SignalStrength = _types.SignalStrength;
import RowMatch = _types.RowMatch;
import RepoUsage = _types.RepoUsage;
import SkillAggregate = _types.SkillAggregate;
import CoOccurrence = _types.CoOccurrence;
import ClassificationResult = _types.ClassificationResult;
import ActivityPoint = _types.ActivityPoint;
import SkillProfileEntry = _types.SkillProfileEntry;
import SkillAnalysisResult = _types.SkillAnalysisResult;
import CategorySkillGroup = _types.CategorySkillGroup;
import SkillGraphNode = _types.SkillGraphNode;
import SkillGraphEdge = _types.SkillGraphEdge;
import SkillGraphView = _types.SkillGraphView;
import InsightSkill = _types.InsightSkill;
import SkillInsights = _types.SkillInsights;
import SkillProofItem = _types.SkillProofItem;
import SkillDetail = _types.SkillDetail;
import ensureSkillIndexes = _writers.ensureSkillIndexes;
import storeSkillCategories = _writers.storeSkillCategories;
import storeSkillDefinitions = _writers.storeSkillDefinitions;
import storeDeveloperSkills = _writers.storeDeveloperSkills;
import storeSkillUsage = _writers.storeSkillUsage;
import storeCoOccurrence = _writers.storeCoOccurrence;

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
    pathPatterns: [/(^|\/)(cypress|e2e)\//],
    codePatterns: [
      /from\s+['"](@playwright\/test|playwright|cypress|puppeteer)['"]/,
    ],
  },

  
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
}
