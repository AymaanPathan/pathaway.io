# Pathway

<p align="center">

### Your GitHub is a history of your code.
### Pathway is a model of your engineering knowledge.

**An engineering intelligence system that reconstructs what your code demonstrates, connects it into a persistent knowledge graph, and uses that graph to reason about your capabilities.**

[Overview](#-what-is-pathway) · [Architecture](#-how-it-works) · [Knowledge Graph](#-the-graph-is-the-product) · [Agents](#-graph-backed-agents) · [Mission Verification](#-from-code-evidence-to-verified-capabilities)

</p>

---

## The problem isn't a lack of developer data. It's a lack of understanding.

A developer can have thousands of commits, dozens of repositories, and years of experience — yet their engineering history remains fragmented across files, pull requests, technologies, and projects.

A list of skills cannot explain how those skills were demonstrated.

A commit count cannot distinguish changing a configuration from implementing a distributed coordination mechanism.

A chatbot can summarize a repository without building a persistent, queryable model of the engineering knowledge expressed in its code.

And a generic recommendation engine cannot reliably explain why a particular engineering task fits a developer's demonstrated capabilities.

**Pathway tackles this problem by turning code history into connected, evidence-backed engineering knowledge.**

It doesn't treat a developer as a résumé. It models the relationships between their code, engineering demonstrations, capabilities, technical concepts, prerequisites, goals, and verified implementations.

## What is Pathway?

Pathway is a graph-centric developer intelligence platform built around one core idea:

> **Engineering capability should be represented as connected evidence, not just a list of skills or a score.**

Pathway analyzes available GitHub history and constructs a persistent engineering knowledge graph using FalkorDB.

The graph connects what exists in the code to what that code demonstrates, how demonstrated capabilities relate to technical concepts, and which dependencies matter when investigating an engineering goal.

Graph queries and algorithms retrieve and analyze that context. AI agents use it to investigate questions, form evidence-backed goals, and plan bounded implementation missions. Verification logic distinguishes proposed work from demonstrated outcomes.

The result is a system that can investigate a developer's engineering knowledge instead of merely describing their activity.

## The core model

```text
                 GITHUB HISTORY
                       │
           ┌───────────┴───────────┐
           ▼                       ▼
       Commits                 Repositories
           │
           ▼
      File Changes
           │
           ▼
   Code-Level Evidence
           │
           ▼
    Demonstrations
           │
           ▼
     Capabilities ─────────── Technical Topics
           │                       │
           ▼                       ▼
     Safeguards              Prerequisites
           │                       │
           └───────────┬───────────┘
                       ▼
              FALKORDB KNOWLEDGE GRAPH
                       │
           ┌───────────┼────────────┐
           ▼           ▼            ▼
       Graph       Goal Agent   Chat Agent
      Analysis         │            │
                       ▼            ▼
                 Mission Plan   Investigation
                       │
                       ▼
                Code Implementation
                       │
                       ▼
                  Verification
                       │
                       ▼
              New Verified Evidence
                       │
                       └──────► Graph Update
```

This is the central distinction: Pathway does not stop at extracting skills from source code. Its architecture connects evidence, knowledge, reasoning, and verified engineering work into one feedback loop.

---

## The graph is the product

FalkorDB is not just a storage layer behind an AI interface. The graph is the foundation on which Pathway organizes and investigates engineering knowledge.

### What the graph represents

| Graph entity | What it represents |
|---|---|
| Developer | The engineer whose work is being analyzed |
| Repository | The codebase containing implementation history |
| Commit | A recorded change to the codebase |
| FileChange | The implementation evidence associated with a change |
| Demonstration | Evidence that an implementation exhibits a capability |
| Capability | A specific engineering ability or mechanism |
| Topic / Concept | A technical subject and its associated knowledge |
| Technique / Safeguard | An implementation approach or correctness mechanism |
| Prerequisite relationship | A dependency between engineering topics or capabilities |
| Goal | A specific engineering objective |
| Mission | A bounded implementation task |
| Verified outcome | An implementation that has passed the defined verification process |

These entities are connected through relationships such as `CHANGED`, `EVIDENCED_BY`, `DEMONSTRATED_IN`, `SUPPORTED_BY`, and `BUILDS_ON`.

That structure allows Pathway to traverse from an engineering claim to its supporting evidence, move between related capabilities, investigate prerequisites, and connect verified work back to the developer's knowledge model.

### Why relationships matter

Consider rate limiting.

Knowing that a repository uses Redis is not, by itself, proof that its developer understands distributed rate limiting.

A more informative investigation would examine the actual implementation, identify the mechanism demonstrated by the code, connect it to the relevant capability, and inspect the supporting evidence.

```text
Developer
   │
   ▼
Demonstration
   │
   ├── EVIDENCED_BY ──► FileChange
   │                        │
   │                        ▼
   │                    Commit
   │
   ├── DEMONSTRATES ──► Capability
   │                        │
   │                        ▼
   │                   Technique
   │
   └── IN_CONTEXT ────► Repository

Capability
   │
   └── BUILDS_ON ─────► Prerequisite Capability
```

The graph makes those connections queryable. It can distinguish a directly supported claim from a possible inference, while exposing missing or unavailable evidence instead of silently treating it as proof.

---

## Graph algorithms with specific jobs

Pathway uses graph analysis to answer different structural questions. No single algorithm is treated as a universal measure of engineering ability.

| Method | Role in Pathway |
|---|---|
| Graph traversal | Follows relationships to retrieve relevant evidence, capabilities, and prerequisites |
| Personalized PageRank | Ranks contextual relevance around selected seed topics |
| Betweenness centrality | Identifies topics that bridge otherwise separate regions of the graph |
| Community analysis | Examines clusters of related engineering knowledge |
| Connectivity analysis | Investigates how topics and capabilities connect |
| Directed prerequisite traversal | Preserves dependency direction when reasoning about what builds on what |

For example, Personalized PageRank can help rank topics relevant to a goal. It does not, by itself, determine whether a developer is qualified for a task.

Likewise, a topic with high betweenness centrality is structurally important to the graph; that does not automatically make it a developer's strongest skill.

**Graph structure supplies context. Evidence supports claims. Agent reasoning turns that context into decisions.**

---

## Graph-backed agents

Pathway uses specialized agents over a shared engineering knowledge model. They serve different purposes rather than independently inventing their own versions of a developer's profile.

### Depth analysis

The depth-analysis workflow assesses technical topics using code evidence, topic relationships, and structured judgments.

It combines AI-assisted discovery and assessment with deterministic reconciliation, evidence-strength constraints, and relationship validation.

The purpose is to build a more informative picture of technical knowledge than a flat technology list.

### Goal reasoning

The Goal Agent investigates a specific engineering objective using graph-derived context, available evidence, related capabilities, prerequisites, and prior verified work.

Its output is intended to be a concrete engineering goal grounded in the current codebase and the developer's demonstrated context — not a generic suggestion to learn a technology.

Goal reasoning must distinguish:

- What the graph directly establishes.
- What the available evidence suggests.
- What remains unknown or unsupported.
- Which implementation context justifies the proposed goal.

### Graph-aware chat

The Chat Agent lets developers ask questions about their engineering knowledge and investigate the answers through graph tools.

It can select relevant tools, follow dependent findings, and return evidence, graph paths, confidence, limitations, and actionable conclusions.

Rather than indiscriminately calling every tool, it can adapt its investigation to the question.

### Mission planning

The Mission Planning Agent turns an established engineering goal into a bounded implementation task.

A mission can specify the implementation scope, relevant files, acceptance criteria, required mechanisms, and constraints that must be preserved.

The intention is to produce a task that can be implemented and evaluated against explicit requirements — not an open-ended learning assignment.

---

## From code evidence to verified capabilities

Pathway treats engineering progress as a lifecycle.

```text
OBSERVE
   │
   ▼
Analyze available code evidence
   │
   ▼
MODEL
   │
   ▼
Connect demonstrations, capabilities,
topics, and prerequisites
   │
   ▼
INVESTIGATE
   │
   ▼
Use graph context to establish
a specific engineering goal
   │
   ▼
PLAN
   │
   ▼
Define a bounded implementation mission
   │
   ▼
IMPLEMENT
   │
   ▼
Evaluate the resulting code
   │
   ▼
VERIFY
   │
   ▼
Check acceptance criteria and verification evidence
   │
   ▼
UPDATE
   │
   ▼
Record the verified demonstration
and refresh relevant engineering knowledge
```

A mission being assigned does not prove a capability. A submission being evaluated does not automatically make it verified.

Pathway's mission workflow distinguishes assigned, evaluated, and verified states. Only verified work is eligible to produce a new demonstration in the capability graph; subsequent unverified submissions can retract that demonstration and mark related assessments stale.

This matters because a developer intelligence system must account for changes in the evidence, not simply accumulate positive claims forever.

**The graph should evolve when the underlying engineering evidence changes.**

---

## What makes Pathway different?

| Conventional developer tools | Pathway's approach |
|---|---|
| Track commits and pull requests | Connect implementation history to engineering demonstrations |
| Present technology lists | Model capabilities and technical relationships |
| Display isolated scores | Provide evidence and graph context for assessments |
| Return generic recommendations | Investigate goals using graph-derived engineering context |
| Generate tasks from prompts | Plan bounded missions with explicit requirements |
| Treat completion as progress | Distinguish completed work from verified demonstrations |
| Start conversations with limited context | Reuse persistent, structured engineering knowledge |

These are architectural distinctions, not a claim that Pathway can perfectly infer every developer's abilities. Its conclusions remain dependent on the repositories, code evidence, graph relationships, and verification data available to it.

---

## Technology stack

- **TypeScript** — application and backend logic
- **FalkorDB** — persistent engineering knowledge graph
- **OpenCypher** — graph querying and traversal
- **GitHub** — source of repository and implementation history
- **Graph algorithms** — contextual ranking and structural analysis
- **AI agents** — evidence investigation, goal reasoning, chat, and mission planning
- **Validation and verification logic** — structured output checks and verified-work lifecycle

## Project status

Pathway is an evolving engineering intelligence system. Its core architecture brings together graph-backed knowledge, code evidence, agent-driven investigation, goal formation, mission planning, and verification.

The focus is on making engineering knowledge connected, persistent, inspectable, and capable of evolving as new implementations are verified.

## The bigger vision

A developer's engineering history should be more than a record of what happened.

It should be a model that can answer why an engineering capability is supported, how that capability connects to other knowledge, what evidence is missing, and how new verified work changes the model.

Pathway is building toward that model.

**Not another list of skills. Not another chatbot that reads your repository.**

**A living, graph-backed model of the engineering knowledge expressed through your code.**

---

*Pathway — Understand the engineering behind your code.*