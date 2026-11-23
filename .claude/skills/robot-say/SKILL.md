---
name: robot-say
description: Keep the user informed of task progress and questions through their RobotConsole robot. Use when asked to notify the robot, speak through robot-say, or announce milestones, questions, blockers and completion in RobotConsole.
---

# Robot progress updates

Use the local `robot-say` command to send brief, factual progress messages in the user's language. It displays a bubble, saves history, and optionally reads the message aloud if the user enabled speech synthesis in RobotConsole.

1. Announce the start of the requested work with one short sentence.
2. Announce meaningful milestones, an actual blocker, or a change of approach. Do not narrate each tool call. Limit routine updates to roughly one per minute.
3. Announce completion only after the requested work is actually complete. State remaining work or a failed check honestly.

Examples in a terminal:

```text
robot-say "Je commence l'analyse du problème."
robot-say "La correction est prête, je vérifie son fonctionnement."
robot-say "Je suis bloqué : une dépendance nécessaire est indisponible."
robot-say "C'est terminé : la correction est en place."
```

Pass the message as one quoted argument. Use the shell's literal-string syntax and escaping; never interpolate user input into executable shell code. Do not include credentials, private file contents, or sensitive information in messages.

## Questions and decisions

Whenever you need an answer from the user during the task, send the actual question to the robot with `robot-say` before presenting it through the CLI's normal question tool or prompt. This includes clarifications, choices, confirmations and approval requests when notification execution is already permitted.

- Display the question itself, not just "I have a question" or "Waiting for your answer". Include the relevant choices so the user knows what decision is needed.
- Use the user's language. Questions are not routine progress updates: do not suppress them because of the one-update-per-minute guideline.
- Still ask through the CLI's native question mechanism and wait for the user's answer there. A robot message does not replace the prompt, collect an answer, or grant permission.
- Never include secrets or sensitive details in the notification; phrase the question safely.
- If the robot cannot be targeted or notification execution requires permission you do not yet have, ask normally in the CLI. Do not bypass permission checks or repeatedly retry notifications.

Example:

```text
robot-say "Quelle base de données dois-je utiliser : PostgreSQL ou SQLite ?"
```

Then present that same question through the CLI's normal question mechanism.

## Target selection

- In a RobotConsole terminal, preserve the inherited `ROBOTCONSOLE_SESSION`, `ROBOTCONSOLE_SPEECH_PIPE` and `ROBOTCONSOLE_USERDATA` variables. The command finds the robot currently containing that terminal, including after moving its tab.
- Do not automatically choose the first robot or broadcast to every robot.
- Outside RobotConsole, the current directory can identify a unique robot. If selection is ambiguous, run `robot-say --list` and ask the user which robot to use, then pass `--robot <id>` for subsequent messages.
- `robot-say --history` reads recent messages for the detected robot; `robot-say --history --robot <id>` selects an explicit robot.

## Errors

The command requires RobotConsole to be open, local shell-command permission, and Node.js. If it is not on PATH, report that it must be installed with `npm link` from the RobotConsole checkout, or use the absolute path to `bin/robot-say.js` with `node` if known. Newly opened integrated terminals have the command on PATH automatically.

If a notification fails, report the failure once in the normal assistant response and continue the requested engineering work. Do not retry in a loop, install software without permission, bypass a sandbox, or claim that the robot received the message.

This skill supplies instructions, not background hooks: assistants must activate it for the ongoing task. It does not run notifications while the assistant is idle.
