---
name: robot-tests
description: Create or update .robot/tests.json based on the project's real test runners, suites and monorepo structure, for the RobotConsole Tests tab.
---

# Configure RobotConsole tests

Inspect project instructions, manifests, lockfiles, workspace declarations, test scripts, runner configurations and representative test files. Read any existing `.robot/tests.json` before editing. Use the actual workspace root; do not create a root-level `tests.json`. Preserve suite IDs, custom settings and existing commands, including a legacy `{ "command": "...", "junit": "..." }` configuration unless migration is requested.

Use the current format for a new file:

```json
{
  "version": 2,
  "suites": [
    {
      "id": "web-unit",
      "name": "Web unit tests",
      "category": "unit",
      "framework": "vitest",
      "cwd": "apps/web",
      "include": ["src/**/*.test.ts"],
      "exclude": ["src/**/*.integration.test.ts"]
    }
  ]
}
```

Only use runners supported by RobotConsole: `vitest`, `jest`, `playwright`, `node` (node:test), `pytest`, `go`, `cargo`, or `custom`. Categories are `unit`, `rules` (business rules), `integration`, `e2e`, and `other`. Each suite needs a unique stable `id`, descriptive `name`, category, framework and an existing `cwd` relative to the workspace root (`""` for root).

For JavaScript runners, use `include` and `exclude` arrays matching the actual runner configuration, or `files` listing actual tests relative to the suite's `cwd`. Globs use `/` separators on all platforms. Avoid duplicate collection across suites and monorepo packages. RobotConsole supplies runner-specific non-watch execution and report flags for built-in frameworks; do not set `command` to override a built-in framework.

Optional fields:

- `args`: array of string arguments for Vitest, Jest or Playwright, for example `["--project", "unit"]` when that named project exists. Other built-in runners do not consume this field.
- `requires`: human-readable prerequisite information for integration/E2E suites, not an executable command.
- `env`: string values only; do not embed secrets or credentials.
- For `framework: "custom"`, `command` is required and must be an existing non-watch test command. Optional `junit` is the report path relative to the workspace root (not the suite's cwd); the command must actually produce that report. Without JUnit, RobotConsole can show the command's output and exit code, but not detailed per-test results.

Use `custom` for unsupported runners or wrapper scripts that cannot safely be represented by a built-in runner. Never invent a report path, test script, framework or test files, and do not install reporters or change dependencies without permission.

Write valid JSON without comments or trailing commas. Parse the saved file, check unique IDs and allowed enums, verify suite directories and representative file/glob matches, and confirm commands against the project. Do not run the test suite, start dependent services or install packages solely to generate configuration. If no tests exist, explain that rather than inventing suites.

Summarize the configured suites and prerequisites in the user's language. When explicitly asked to open the configuration, use the robot-open skill after saving.
