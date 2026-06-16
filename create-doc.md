# SKILL.md

## Task: Generate Framework-Style Documentation from Codebase

Analyze the entire codebase and generate professional, framework-style documentation.

The documentation should treat the project as if it is a **public developer framework/platform**.

---

## Documentation Structure

### # Overview

- What the framework/project does
- Main purpose
- Core concepts
- Key features
- Architecture overview

---

### # Getting Started

- Installation
- Requirements
- Environment setup
- Configuration
- Quick start example

---

### # Project Structure

Explain the folder and module structure in detail:

- Purpose of each major directory
- Responsibilities of important modules
- Dependency relationships

---

### # Core Architecture

Explain:

- System design
- Request flow
- Event flow
- State management
- Service interactions
- Internal abstractions
- Plugin/module system (if present)

---

### # API Reference

Document:

- Public APIs
- Classes
- Functions
- Methods
- Interfaces
- Schemas
- Types
- Config options

For each item include:

- Purpose
- Parameters
- Return values
- Example usage
- Error handling behavior

---

### # Developer Guide

Explain:

- How to extend the framework
- How to add new modules/features
- Best practices
- Internal conventions
- Common patterns

---

### # Authentication & Security

Explain:

- Auth flow
- Permission system
- Middleware
- Security considerations

---

### # Database Layer

Explain:

- Models
- ORM usage
- Relationships
- Migrations
- Query patterns

---

### # Background Jobs / Queues

Explain:

- Job architecture
- Scheduling
- Workers
- Retry mechanisms

---

### # AI/LLM Architecture (if applicable)

Explain:

- Agent architecture
- Memory systems
- Tool calling
- Prompt orchestration
- RAG pipelines
- Vector storage
- Model routing

---

### # Examples

Generate practical examples for common use cases.

---

### # Deployment

Explain:

- Production setup
- Docker
- CI/CD
- Environment variables
- Scaling considerations

---

### # Troubleshooting

Generate:

- Common issues
- Debugging steps
- Logging strategy
- Performance bottlenecks

---

### # Contributing

Generate contribution guidelines and development workflow.

---

## Important Instructions

- Infer architecture directly from the codebase.
- Do not hallucinate nonexistent features.
- Use real code examples from the repository.
- Explain complex flows step-by-step.
- Generate diagrams in Mermaid when useful.
- Write concise but professional documentation.
- Prefer developer-oriented explanations.
- Include sequence diagrams for important flows.
- Generate markdown files ready for Docusaurus / VitePress / Fumadocs.
- Create sidebar/navigation structure suggestions.
- Identify undocumented or unclear areas in the codebase.
- Suggest improvements.

---

## Focus Areas

Pay special attention to:

- request lifecycle
- service boundaries
- async flows
- dependency injection
- event-driven logic
- caching
- websocket flows
- AI agent orchestration where architecture appears problematic
