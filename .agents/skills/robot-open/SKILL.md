---
name: robot-open
description: Open a file in a RobotConsole editor tab. Use when the user asks to open or display a file in RobotConsole, including after creating a file such as todo.md.
---

# Open a file in RobotConsole

Use this skill when the user explicitly asks to open a file, including "create todo.md and open it". First create or edit the file as requested, then open the saved file:

```text
robot-open "todo.md"
robot-open "path with spaces/file.md"
```

Use the current shell's path separators. Relative paths are resolved from the terminal's current directory; an absolute path also works. Pass exactly one literal quoted path. For a name starting with `--`, use `robot-open -- "--notes.md"`. Never interpolate a path into executable shell code.

Before executing, check that `ROBOTCONSOLE_SESSION` and `ROBOTCONSOLE_SPEECH_PIPE` are present. Preserve these variables: they identify the robot currently containing the terminal, even after moving its tab. Never select the first robot, broadcast, or open the operating system's default editor instead.

The command opens an editor tab in RobotConsole, or activates the file's existing editor tab. It does not create files. Confirm that the file exists before invoking it. Only claim that the tab opened after the command succeeds.

Outside an integrated RobotConsole terminal, explain that opening the tab requires one; still complete any requested file creation. Node.js and local command permission are required. If the command is not on PATH, use `node` with the absolute path to RobotConsole's `bin/robot-open.js` only if that checkout is known, or explain that a new integrated terminal is needed. Report execution errors without retrying in a loop or installing software without permission.
