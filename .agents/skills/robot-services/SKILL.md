---
name: robot-services
description: Create or update .robot/services.json for the current project so RobotConsole can launch and monitor its development services. Use when asked to configure RobotConsole services based on a project.
---

# Configure RobotConsole services

Inspect the current project's instructions, README, package manifests, lockfiles, workspace declarations, development scripts, Docker Compose files and relevant server configuration. Determine the actual workspace root and package folders before writing `.robot/services.json`. This is not a root-level `services.json`.

Read any existing file first. Preserve existing services, IDs, custom fields and user choices; merge by stable ID rather than replacing the file blindly. Ask for clarification if the intended command or workspace is ambiguous. Use commands and package managers actually present in the project; do not invent scripts, ports, health routes or dependencies.

The format is an object with a `services` array. For example, only when supported by the inspected project:

```json
{
  "services": [
    {
      "id": "web",
      "name": "Web",
      "command": "npm run dev",
      "cwd": "apps/web",
      "port": 5173,
      "autostart": false,
      "restart": false
    }
  ]
}
```

- `id`: unique stable string; `name`: human-readable label; `command`: nonempty shell command.
- `cwd`: existing directory relative to the workspace root; `""` means the root.
- Optional `port`: integer from 1 to 65535, only when verified.
- Optional `url` or `health`: verified HTTP health URL. A URL is actively probed; omit it if uncertain.
- Optional `shellId`: an installed RobotConsole shell, only when known; omit to use the default.
- Optional `env`: object of string environment values. Never copy secrets or credentials from `.env`; prefer the project's existing environment loading.
- `autostart` and `restart`: default to `false` for new services unless the user explicitly requests them. Existing values must be preserved.

Include long-running development services, not build, migration or test commands. Avoid defining both a monorepo orchestrator and its child services if that would start duplicate processes. Docker Compose may be a foreground service if the project uses it; do not silently run it.

Write valid JSON without comments or trailing commas. Validate by parsing the saved file, checking unique IDs, required command strings and existing working directories. Do not start services, install dependencies or modify unrelated configuration just to validate the file. If no service is supported by the project, explain that rather than inventing one.

Summarize the services and any prerequisites in the user's language. When explicitly asked to open the configuration, use the robot-open skill after saving.
