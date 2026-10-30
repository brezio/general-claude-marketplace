export type Note = { label: string; value: string }

/** The project's notes as read from its two files, and what it asks Claude to record. */
export type Project = {
  /** The repository's top level (or the session's directory outside git); empty until read. */
  root: string
  /** From the shared file's `record`: what this project wants kept as notes. */
  record: string
  shared: Note[]
  local: Note[]
  /** Why a file could not be read, shown in the pane. */
  error?: string
}

declare module 'claude-code' {
  interface PluginState {
    'project-notes': { session: Shaped<Note[]>; project: Shaped<Project> }
  }
}
