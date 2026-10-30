# project-notes

A pane beside the Claude Code chat with the notes and links you want to find again, in two sections:

- **Project**: facts about the repository. Shared ones live in `.claude/project-notes.json` (commit it); this machine's own in `.claude/project-notes.local.json` (keep it out of git).
- **Session**: what this session set up, such as the dev server URL, the mail catcher, a worktree. Gone when the session ends.

Claude keeps the pane current with its `note` tool, without being asked. You can too:

```
/notes                                          show or hide the pane
/notes add [--local|--project] <label>: <value>
/notes remove [--local|--project] <label>
/notes record [--local] <what Claude should keep as notes>
/notes record [--local]                         show the instructions (--clear removes them)
```

With no flag a note is the session's. The pane docks on the right in Claude Code's fullscreen layout; on the main screen it sits above the prompt.

## Telling Claude what to record

`/notes record <text>` writes a `record` field to the project's shared file (`--local` to this machine's, which adds to it). By hand it looks like:

```json
{
  "record": "Note the local app URL and port, the Mailpit URL, and the worktree path and branch whenever you start or change one.",
  "notes": [
    { "label": "Staging", "value": "https://staging.example.com" }
  ]
}
```

Claude reads `record`, and every note, in its `note` tool's description, which is updated whenever they change. It adds `project` notes only when you ask; `local` and `session` notes it keeps on its own. Edits to either file by hand show in the pane within 15 seconds.

## Install

From the [general-claude-marketplace](../../README.md):

```
/plugin marketplace add brezio/general-claude-marketplace
/plugin install project-notes@general-claude-marketplace
```

## Notes on behaviour

- The pane opens by itself at session start in a wide enough terminal; `/notes` opens it at any width.
- The mod runs `git rev-parse` to find the repository's top level and `git check-ignore` to warn when the local file would be committed. It reads and writes only the two `.claude/project-notes*.json` files.
- Don't keep secrets in notes: the pane and its files are not a secret store.

## License

MIT, see the repository's [LICENSE](../../LICENSE).
