# general-claude-marketplace

General-purpose Claude Code plugins from Brezio.

## Add the marketplace

At the prompt of a Claude Code terminal session:

```
/plugin marketplace add brezio/general-claude-marketplace
```

From a shell:

```
claude plugin marketplace add brezio/general-claude-marketplace
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `brezio/general-claude-marketplace`.

Then install a plugin by name, e.g. `/plugin install project-notes@general-claude-marketplace`.

## Plugins

| Plugin | What it does |
| --- | --- |
| [project-notes](plugins/project-notes) | A pane beside the chat with project and session notes (dev server URLs, mail catchers, worktrees) that Claude keeps current; `/notes` shows, adds, removes, and sets what each project asks Claude to record. |

## Adding a plugin

Put it in `plugins/<name>/` with its own `.claude-plugin/plugin.json` and README, list it in `.claude-plugin/marketplace.json`, and run `claude plugin validate .` before pushing.

## License

MIT, see [LICENSE](LICENSE), unless a plugin's folder says otherwise.
