# Claude Agent SDK — Best Practices

> **Purpose:** Reference document for Claude Code to follow when building agents using the Claude Agent SDK (Python). Based on official Anthropic documentation as of April 2026.

---

## 1. SDK Fundamentals

The Claude Agent SDK (formerly "Claude Code SDK") gives you the same agent loop, tools, and context management that power Claude Code, available as a Python library.

### Core entry point: `query()`

```python
import asyncio
from claude_agent_sdk import query, ClaudeAgentOptions, ResultMessage

async def main():
    async for message in query(
        prompt="Find and fix the bug in auth.py",
        options=ClaudeAgentOptions(
            allowed_tools=["Read", "Edit", "Bash"],
            permission_mode="acceptEdits",
        ),
    ):
        if isinstance(message, ResultMessage) and message.subtype == "success":
            print(message.result)

asyncio.run(main())
```

Key facts:
- Each `query()` call starts a fresh session (no memory of prior calls) unless you explicitly resume/continue.
- The SDK handles tool execution, context management, retries, and compaction automatically.
- Node.js is required at runtime (bundled with the SDK package).

---

## 2. The Agent Loop

The loop follows this cycle:

1. **Receive prompt** — Claude gets the prompt + system prompt + tool definitions + history.
2. **Evaluate & respond** — Claude produces text, tool calls, or both → yields `AssistantMessage`.
3. **Execute tools** — SDK runs each requested tool, collects results → yields `UserMessage`.
4. **Repeat** — Steps 2–3 repeat (each full cycle = one "turn") until Claude produces a response with no tool calls.
5. **Return result** — SDK yields a final `ResultMessage` with text, usage, cost, and session ID.

### Message types to handle

| Type | When | Use it for |
|------|------|-----------|
| `SystemMessage` | Session init, compaction boundaries | Metadata, logging |
| `AssistantMessage` | After each Claude response | Progress display, tool call inspection |
| `UserMessage` | After each tool execution | Tool result inspection |
| `StreamEvent` | When partial messages are enabled | Real-time streaming UI |
| `ResultMessage` | Always last | Final output, cost tracking, success/failure checks |

### Best practice: always check `ResultMessage.subtype`

```python
if isinstance(message, ResultMessage):
    if message.subtype == "success":
        print(message.result)
    elif message.subtype == "error_max_turns":
        print("Hit turn limit")
    elif message.subtype == "error_max_budget_usd":
        print("Hit budget limit")
    elif message.subtype == "error_during_execution":
        print("Execution error:", message.errors)
```

---

## 3. Tool Configuration

### Principle of least privilege

Only grant the tools your agent actually needs.

```python
# ✅ Read-only analysis agent
options = ClaudeAgentOptions(
    allowed_tools=["Read", "Glob", "Grep"],
)

# ✅ Code-fixing agent
options = ClaudeAgentOptions(
    allowed_tools=["Read", "Edit", "Glob", "Bash"],
    permission_mode="acceptEdits",
)

# ❌ Avoid: overly broad with bypass
options = ClaudeAgentOptions(
    permission_mode="bypassPermissions",  # Never in production
)
```

### `allowed_tools` vs `disallowed_tools`

- **Prefer `allowed_tools`** — omitting a tool removes it from context entirely, so Claude never wastes a turn trying it.
- **`disallowed_tools`** blocks the call but the tool remains visible in context, causing wasted turns.
- For a locked-down headless agent, pair `allowed_tools` with `permission_mode="dontAsk"`: listed tools are approved, everything else is hard-denied.

### Built-in tools reference

| Tool | Purpose |
|------|---------|
| `Read` | Read file contents |
| `Write` | Write/create files |
| `Edit` / `MultiEdit` | Targeted file edits |
| `Bash` | Run shell commands |
| `Glob` | Find files by pattern |
| `Grep` | Search file contents |
| `WebSearch` | Search the web |
| `Agent` | Spawn subagents |
| `Skill` | Invoke agent skills |
| `AskUserQuestion` | Prompt user for input |

---

## 4. Permission Modes

The SDK evaluates permissions in this order:
1. **PreToolUse hooks** (can allow/deny/modify)
2. **Deny rules** (`disallowed_tools`, settings.json) — block even in `bypassPermissions`
3. **Allow rules** (`allowed_tools`, settings.json)
4. **Ask rules**
5. **Permission mode check**
6. **`can_use_tool` callback**
7. **PostToolUse hooks**

### Mode summary

| Mode | Behavior | When to use |
|------|----------|-------------|
| `default` | All tools go through permission flow | Production, full control |
| `acceptEdits` | Auto-approves file operations (Write/Edit) | Prototyping, isolated dirs |
| `dontAsk` | Denies anything not pre-approved | Headless agents, CI/CD |
| `plan` | Claude plans but cannot execute | Review before execution |
| `bypassPermissions` | Auto-approves everything | **Controlled sandboxes only** |

### Critical warnings

- **`bypassPermissions` is inherited by all subagents** and cannot be overridden. Subagents get full system access.
- **`allowed_tools` does NOT constrain `bypassPermissions`** — every tool is approved, not just listed ones. Use `disallowed_tools` to block specific tools.

---

## 5. System Prompts & CLAUDE.md

### Three approaches to system prompts

**1. Default (minimal):** Contains only essential tool instructions. No coding guidelines or project context.

**2. Claude Code preset (recommended for coding agents):**
```python
options = ClaudeAgentOptions(
    system_prompt={"type": "preset", "preset": "claude_code"},
)
```

**3. Append to preset:**
```python
options = ClaudeAgentOptions(
    system_prompt={
        "type": "preset",
        "preset": "claude_code",
        "append": "You are a senior Python developer. Follow PEP 8.",
    },
)
```

**4. Fully custom string:**
```python
options = ClaudeAgentOptions(
    system_prompt="You are a security auditor. Never modify files.",
)
```

### Loading CLAUDE.md and project config

The SDK **does not** load filesystem settings by default. You must opt in:

```python
options = ClaudeAgentOptions(
    setting_sources=["user", "project"],  # Loads ~/.claude/ and ./.claude/
)
```

This enables: CLAUDE.md instructions, Skills, filesystem hooks, and settings.json permission rules.

> **Important:** The `claude_code` system prompt preset does NOT automatically load CLAUDE.md — you must also set `setting_sources`.

---

## 6. Custom Tools

Define tools inline using the `@tool` decorator and wrap in an MCP server:

```python
from claude_agent_sdk import tool, create_sdk_mcp_server

@tool(
    "get_temperature",
    "Get current temperature at a location",
    {"latitude": float, "longitude": float},
)
async def get_temperature(args: dict) -> dict:
    # ... fetch data ...
    return [{"type": "text", "text": f"Temperature: {temp}°F"}]

weather_server = create_sdk_mcp_server([get_temperature])
```

Then pass to query:

```python
options = ClaudeAgentOptions(
    mcp_servers={"weather": weather_server},
    allowed_tools=["mcp__weather__get_temperature"],
)
```

### Error handling in custom tools

How your handler reports errors determines whether the loop continues or stops:

- **Return an error result** → loop continues, Claude can retry or adapt.
- **Throw/raise an exception** → loop may stop depending on error type.

Always catch errors inside handlers and return them as error results:

```python
@tool("fetch_data", "Fetch data from API", {"endpoint": str})
async def fetch_data(args):
    try:
        response = await client.get(args["endpoint"])
        if response.status_code != 200:
            return [{"type": "text", "text": f"Error: HTTP {response.status_code}"}]
        return [{"type": "text", "text": response.text}]
    except Exception as e:
        return [{"type": "text", "text": f"Error: {e}"}]
```

---

## 7. MCP Server Integration

Connect to external tools via the Model Context Protocol:

```python
options = ClaudeAgentOptions(
    mcp_servers={
        "playwright": {"command": "npx", "args": ["@playwright/mcp@latest"]},
        "github": {
            "type": "http",
            "url": "https://api.githubcopilot.com/mcp/",
        },
    },
    allowed_tools=["mcp__playwright__*"],  # Wildcard for all tools from a server
)
```

### Transport types

| Transport | Use case |
|-----------|----------|
| `stdio` | Local process, communicates via stdin/stdout |
| `sse` | HTTP streaming (Server-Sent Events) |
| `http` | HTTP non-streaming |

### Tool search

When you have many MCP tools, tool definitions consume context window space. Tool search is **enabled by default** — it withholds definitions from context and loads only the ones Claude needs per turn.

### Timeouts

The MCP SDK has a **default 60-second timeout** for server connections. If your server takes longer, the connection fails.

---

## 8. Subagents

Subagents are isolated agent instances for focused subtasks. They get a **fresh context window** (no parent conversation).

```python
from claude_agent_sdk import AgentDefinition

options = ClaudeAgentOptions(
    allowed_tools=["Read", "Glob", "Grep", "Agent"],
    agents={
        "code-reviewer": AgentDefinition(
            description="Expert code review specialist.",
            prompt="Analyze code quality and suggest improvements.",
            tools=["Read", "Glob", "Grep"],  # Read-only, can't modify
        ),
        "test-runner": AgentDefinition(
            description="Runs and validates test suites.",
            prompt="Execute tests and report results.",
            tools=["Read", "Bash", "Glob"],
        ),
    },
)
```

### Best practices for subagents

- **Restrict tools per subagent.** A reviewer shouldn't have Write access.
- **Include `Agent` in `allowed_tools`** — Claude invokes subagents through the Agent tool.
- **Pass all necessary context in the prompt string** — the only channel from parent to subagent is the Agent tool's `prompt` field. Include file paths, error messages, and decisions.
- **The parent receives the subagent's final message verbatim** as the tool result.
- **Use programmatic definitions** (the `agents` parameter) for SDK applications rather than filesystem-based `.claude/agents/` files.

---

## 9. Hooks

Hooks are callbacks that run at key points in the agent lifecycle.

### Available hook events

| Event | Fires when | Can do |
|-------|-----------|--------|
| `PreToolUse` | Before a tool executes | Allow, deny, or modify input |
| `PostToolUse` | After a tool executes | Log, react to results |
| `Stop` | Agent is about to stop | Inject feedback to continue |
| `SessionStart` | Session begins | Initialize resources |
| `SessionEnd` | Session ends | Cleanup |

### Example: block writes to sensitive files

```python
async def block_env_writes(input_data, tool_use_id, context):
    file_path = input_data.get("tool_input", {}).get("file_path", "")
    if file_path.endswith(".env"):
        return {
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "deny",
                "permissionDecisionReason": "Cannot modify .env files",
            }
        }
    return {}
```

### Hook output structure

Always return `permissionDecision` inside `hookSpecificOutput`, and include `hookEventName`:

```python
return {
    "hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "allow",   # or "deny"
        "updatedInput": { ... },          # optional: modify tool input
    },
    "systemMessage": "...",               # optional: inject context
}
```

---

## 10. Sessions

A session is the full conversation history accumulated during agent work: prompt, tool calls, results, and responses.

### Session patterns

| Pattern | How | When |
|---------|-----|------|
| Single query | Default `query()` | One-shot tasks |
| Continue | `continue=True` on next `query()` | Multi-step in same process |
| Resume | Pass `resume=session_id` | Return to a prior session |
| Fork | `resume=session_id, fork_session=True` | Branch to try a different approach |
| Client | `ClaudeSDKClient` as context manager | Multi-turn conversations |

### ClaudeSDKClient for multi-turn

```python
from claude_agent_sdk import ClaudeSDKClient, ClaudeAgentOptions

async with ClaudeSDKClient(options=ClaudeAgentOptions(...)) as client:
    await client.query("Analyze the auth module")
    async for msg in client.receive_response():
        print(msg)

    await client.query("Now refactor it")  # Has full context from first query
    async for msg in client.receive_response():
        print(msg)
```

### Important notes

- Sessions persist **conversation**, not **filesystem state**. Use file checkpointing to snapshot/revert file changes.
- Set `persist_session=False` for ephemeral/automated workflows where history isn't needed.

---

## 11. Cost & Resource Control

### Always set budgets in production

```python
options = ClaudeAgentOptions(
    max_turns=20,           # Cap tool-use turns
    max_budget_usd=1.00,    # Cap total spend
)
```

- `max_turns` counts **tool-use turns only** (the final text-only response doesn't count).
- Without limits, the loop runs until Claude finishes — fine for well-scoped tasks, risky for open-ended prompts.

### Track costs from ResultMessage

```python
if isinstance(message, ResultMessage):
    print(f"Cost: ${message.total_cost_usd:.4f}")
    print(f"Turns: {message.num_turns}")
    print(f"Duration: {message.duration_ms}ms")
```

---

## 12. Security Best Practices

### Defense in depth — layer your controls

```python
# ✅ Layered security
options = ClaudeAgentOptions(
    allowed_tools=["Read", "Write", "Bash"],
    permission_mode="default",
    hooks={"PreToolUse": [security_hook]},
    can_use_tool=permission_callback,
)

# ❌ Never in production
options = ClaudeAgentOptions(
    permission_mode="bypassPermissions",
)
```

### Sandboxing

The SDK should run inside a sandboxed container (Docker, gVisor, Firecracker) providing:
- Process isolation
- Resource limits
- Network control
- Ephemeral filesystems

### Credential management

Never expose credentials to the agent. Use a **proxy pattern**:
1. Agent sends requests without credentials.
2. A proxy outside the sandbox injects credentials into outgoing requests.
3. Proxy forwards to the real API.

### Prompt injection awareness

Claude's actions are generated dynamically based on context. Content it processes (files, web pages, user input) can influence behavior. Mitigate by:
- Restricting tool access to the minimum needed
- Using hooks to validate tool inputs before execution
- Running in sandboxed environments
- Setting network egress controls

---

## 13. Skills

Skills are filesystem-based capabilities defined as `SKILL.md` files with YAML frontmatter.

### Enabling in SDK

```python
options = ClaudeAgentOptions(
    cwd="/path/to/project",
    setting_sources=["user", "project"],  # Required to discover skills
    allowed_tools=["Skill", "Read", "Write", "Bash"],
)
```

### Skill locations

| Directory | Scope | Loaded when |
|-----------|-------|-------------|
| `.claude/skills/` | Project (shared via git) | `setting_sources` includes `"project"` |
| `~/.claude/skills/` | User (personal, all projects) | `setting_sources` includes `"user"` |
| Plugin skills | Bundled with plugins | Plugin installed |

Skills are **model-invoked** — Claude autonomously chooses when to use them based on the `description` field in the YAML frontmatter.

---

## 14. Hosting & Deployment Patterns

### Container patterns

| Pattern | Description | Best for |
|---------|-------------|----------|
| Long-lived | Persistent container, always running | Chat bots, email agents, always-on services |
| Ephemeral | Spin up per task, hydrate with state | Project managers, deep research, support tickets |
| Multi-agent | Multiple SDK processes in one container | Simulations (requires preventing overwrite conflicts) |

### Key hosting considerations

- **Set `max_turns`** to prevent the agent from looping indefinitely.
- **Sessions don't timeout**, but container idle timeouts should be tuned based on expected user response frequency.
- **Dominant cost is tokens**, not compute. Container costs are ~$0.05/hr minimum; tune idle timeouts accordingly.
- **Expose HTTP/WebSocket endpoints** for external clients while the SDK runs internally.

---

## 15. Structured Output

Request structured JSON output from your agent for programmatic consumption:

```python
options = ClaudeAgentOptions(
    allowed_tools=["Read", "Glob"],
    structured_output={"type": "json", "schema": my_json_schema},
)
```

The SDK retries automatically if the output doesn't match your schema. Check `ResultMessage.structured_output` for the parsed value.

---

## 16. File Checkpointing

Enable file checkpointing to snapshot and revert filesystem changes:

```python
options = ClaudeAgentOptions(
    enable_file_checkpointing=True,
    allowed_tools=["Read", "Write", "Edit"],
)
```

When enabled, the SDK creates backups of files before modification. This is critical for testing and CI/CD workflows where you need to reset state between runs.

---

## 17. Quick Reference: Common Agent Patterns

### Read-only analyzer
```python
ClaudeAgentOptions(
    allowed_tools=["Read", "Glob", "Grep"],
    permission_mode="dontAsk",
    max_turns=10,
    max_budget_usd=0.50,
)
```

### Code fixer with tests
```python
ClaudeAgentOptions(
    allowed_tools=["Read", "Edit", "Glob", "Bash"],
    permission_mode="acceptEdits",
    system_prompt={"type": "preset", "preset": "claude_code"},
    max_turns=30,
    max_budget_usd=2.00,
)
```

### Multi-agent review pipeline
```python
ClaudeAgentOptions(
    allowed_tools=["Read", "Glob", "Grep", "Agent"],
    agents={
        "security-reviewer": AgentDefinition(
            description="Security vulnerability scanner.",
            prompt="Scan for security issues. Report severity and remediation.",
            tools=["Read", "Glob", "Grep"],
        ),
        "perf-reviewer": AgentDefinition(
            description="Performance analyzer.",
            prompt="Identify performance bottlenecks and suggest optimizations.",
            tools=["Read", "Glob", "Grep"],
        ),
    },
    max_budget_usd=3.00,
)
```

### Web-enabled research agent
```python
ClaudeAgentOptions(
    allowed_tools=["Read", "Glob", "WebSearch", "Bash"],
    permission_mode="acceptEdits",
    max_budget_usd=1.00,
)
```

---

## 18. Checklist Before Shipping

- [ ] `allowed_tools` is set to the minimum required tools
- [ ] `permission_mode` is NOT `bypassPermissions` in production
- [ ] `max_turns` and/or `max_budget_usd` are set
- [ ] `ResultMessage.subtype` is checked for errors, not just success
- [ ] Custom tool handlers catch exceptions and return error results
- [ ] Agent runs in a sandboxed container with network controls
- [ ] Credentials are injected via proxy, not passed to the agent
- [ ] Hooks validate sensitive tool inputs (file paths, shell commands)
- [ ] `setting_sources` is configured if you need CLAUDE.md or Skills
- [ ] Cost tracking is implemented via `ResultMessage.total_cost_usd`

---

*Sources: [Agent SDK Overview](https://platform.claude.com/docs/en/agent-sdk/overview) · [Quickstart](https://platform.claude.com/docs/en/agent-sdk/quickstart) · [Agent Loop](https://platform.claude.com/docs/en/agent-sdk/agent-loop) · [Permissions](https://platform.claude.com/docs/en/agent-sdk/permissions) · [Custom Tools](https://platform.claude.com/docs/en/agent-sdk/custom-tools) · [Hooks](https://platform.claude.com/docs/en/agent-sdk/hooks) · [Subagents](https://platform.claude.com/docs/en/agent-sdk/subagents) · [Sessions](https://platform.claude.com/docs/en/agent-sdk/sessions) · [Hosting](https://platform.claude.com/docs/en/agent-sdk/hosting) · [Secure Deployment](https://platform.claude.com/docs/en/agent-sdk/secure-deployment) · [System Prompts](https://platform.claude.com/docs/en/agent-sdk/modifying-system-prompts) · [Skills](https://platform.claude.com/docs/en/agent-sdk/skills)*
