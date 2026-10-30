import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Note, Project } from '../types'

const PANE = 'project-notes'
const TITLE = 'Project notes'
const TOOL = 'mcp__project-notes__note'
// Shared with the team (commit it) and this machine's own (keep it out of git).
const SHARED_FILE = '.claude/project-notes.json'
const LOCAL_FILE = '.claude/project-notes.local.json'
const REFRESH_MS = 15_000

// Change a tag when its value's fields change: it declines what an earlier
// version stored, which outlives a reload.
const sessionNotes = atom({ plugin: 'project-notes', key: 'session' } as const, [], {
  shape: 'session-1',
})
const project = atom(
  { plugin: 'project-notes', key: 'project' } as const,
  { root: '', record: '', shared: [], local: [] },
  { shape: 'project-1' },
)

type Scope = 'session' | 'project' | 'local'
type NotesFile = { record?: string; notes?: Note[] }

const isUrl = (s: string) => /^https?:\/\/\S+$/.test(s)

function upsert(list: readonly Note[], label: string, value: string): Note[] {
  if (value === '') return list.filter(n => n.label !== label)
  const note = { label, value }
  return list.some(n => n.label === label)
    ? list.map(n => (n.label === label ? note : n))
    : [...list, note]
}

function asNotes(v: unknown): Note[] {
  if (!Array.isArray(v)) return []
  return v.flatMap(n =>
    n && typeof n.label === 'string' && typeof n.value === 'string'
      ? [{ label: n.label, value: n.value }]
      : [],
  )
}

async function projectRoot($: EngineInterface, cwd: string): Promise<string> {
  try {
    const git = await $.process.run(['git', 'rev-parse', '--show-toplevel'], { cwd, timeoutMs: 5000 })
    if (git.exitCode === 0 && git.stdout.trim() !== '') return git.stdout.trim()
  } catch {
    // no git on the host: the session's directory stands in
  }
  return cwd
}

async function readFile($: EngineInterface, path: string): Promise<NotesFile> {
  if (!(await $.fs.exists(path))) return {}
  const parsed: unknown = JSON.parse(await $.fs.read(path))
  return parsed && typeof parsed === 'object' ? (parsed as NotesFile) : {}
}

async function load($: EngineInterface, root: string): Promise<void> {
  let next: Project
  try {
    const shared = await readFile($, `${root}/${SHARED_FILE}`)
    const local = await readFile($, `${root}/${LOCAL_FILE}`)
    next = {
      root,
      // The machine's own instructions add to the shared ones.
      record: [shared.record, local.record].filter(r => typeof r === 'string' && r !== '').join('\n'),
      shared: asNotes(shared.notes),
      local: asNotes(local.notes),
    }
  } catch (err) {
    next = { root, record: '', shared: [], local: [], error: `could not read the notes files: ${String(err)}` }
  }
  // Only write on a change: a write redraws the pane.
  await update($, project, old => (JSON.stringify(old) === JSON.stringify(next) ? old : next))
}

async function writeFile($: EngineInterface, path: string, label: string, value: string): Promise<void> {
  const file = await readFile($, path)
  const notes = upsert(asNotes(file.notes), label, value)
  await $.fs.write(path, JSON.stringify({ ...file, notes }, null, 2) + '\n')
}

async function isIgnored($: EngineInterface, root: string, path: string): Promise<boolean> {
  try {
    const git = await $.process.run(['git', 'check-ignore', '-q', path], { cwd: root, timeoutMs: 5000 })
    return git.exitCode === 0
  } catch {
    return true
  }
}

function guidance(p: Project, session: readonly Note[]): string {
  const list = (notes: readonly Note[]) => notes.map(n => `- ${n.label}: ${n.value}`).join('\n')
  const parts = [
    "Keep a note in the person's Project notes pane, beside the chat. Keep the pane current as things change, without being asked: add what they will want to find again (a local app URL, a mail catcher URL, a worktree or branch, a running server and its port), replace a note when its value changes (same label and scope), and clear one with an empty value when it stops being true. Scopes: `session` (default) for this session only, such as a server you started or a worktree you made; `local` for this machine's lasting details of the project, kept out of git; `project` for facts true for everyone on the project, written to the repo's shared file, so add or change those only when the person asks.",
  ]
  if (p.record !== '') parts.push(`What this project asks you to record:\n${p.record}`)
  if (p.shared.length + p.local.length > 0) parts.push(`Project notes now:\n${list([...p.shared, ...p.local])}`)
  if (session.length > 0) parts.push(`Session notes now:\n${list(session)}`)
  return parts.join('\n\n')
}

const TOOL_SPEC = {
  name: 'note',
  inputSchema: {
    type: 'object',
    properties: {
      label: { type: 'string', description: 'Short name, e.g. "App" or "Mailpit"' },
      value: { type: 'string', description: 'A URL, path or short text; a URL alone becomes a link; empty removes the note' },
      scope: { type: 'string', enum: ['session', 'local', 'project'], description: 'Where the note lives; default session' },
    },
    required: ['label', 'value'],
  },
  isDeferred: false,
}

// The guidance rides the tool's description, which the model always reads: a
// prompt.compose section can be skipped by an organization's policy plugin.
let lastDescription = ''
async function describeTool($: EngineInterface): Promise<void> {
  const description = guidance(await read($, project), await read($, sessionNotes))
  if (description === lastDescription) return
  lastDescription = description
  await $.tool.register({ ...TOOL_SPEC, description })
}

const USAGE = [
  '/notes                               show or hide the pane',
  '/notes add [--local|--project] <label>: <value>',
  '/notes remove [--local|--project] <label>',
  '/notes record [--local] <what Claude should keep as notes>',
  '/notes record [--local]              show the instructions; "/notes record --clear" removes them',
].join('\n')

/** `--local` / `--project` anywhere in the args, and the rest. */
function scopeOf(words: string): { scope: Scope; rest: string } {
  const scope: Scope = /(^|\s)--local(\s|$)/.test(words) ? 'local' : /(^|\s)--project(\s|$)/.test(words) ? 'project' : 'session'
  return { scope, rest: words.replace(/(^|\s)--(local|project)(?=\s|$)/g, ' ').trim() }
}

// The repository's top level, set at session.start (which a reload runs again).
let root = ''

async function save($: EngineInterface, scope: Scope, label: string, value: string): Promise<string> {
  const done = value === '' ? `Removed "${label}"` : `Noted "${label}"`
  if (scope === 'session') {
    await update($, sessionNotes, list => upsert(list, label, value))
    await describeTool($)
    return `${done} for this session.`
  }
  if (root === '') throw new Error('the project folder is not known yet')
  const file = scope === 'project' ? SHARED_FILE : LOCAL_FILE
  await writeFile($, `${root}/${file}`, label, value)
  await refresh($)
  let result = `${done} in ${file}.`
  if (scope === 'local' && !(await isIgnored($, root, file))) {
    result += ` ${file} is not ignored by git: add it to .gitignore.`
  }
  return result
}

async function refresh($: EngineInterface): Promise<void> {
  if (root === '') return
  await load($, root)
  await describeTool($)
}

/** `/notes record [--local] [text | --clear]`: show, set or clear the project's instructions. */
async function record($: EngineInterface, args: string): Promise<string> {
  if (root === '') return 'The project folder is not known yet.'
  const { scope, rest } = scopeOf(args)
  const file = scope === 'local' ? LOCAL_FILE : SHARED_FILE
  const path = `${root}/${file}`
  const { record: current, ...others } = await readFile($, path)
  if (rest === '') return current ? `Instructions in ${file}:\n${current}` : `No instructions in ${file} yet.`
  await $.fs.write(path, JSON.stringify(rest === '--clear' ? others : { record: rest, ...others }, null, 2) + '\n')
  await refresh($)
  return rest === '--clear'
    ? `Removed the instructions in ${file}.`
    : `Saved the instructions in ${file}. Claude reads them from the next turn.`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    root = await projectRoot($, e.cwd)
    await load($, root)
    await describeTool($)
    // People edit the files by hand too; pick that up without a restart.
    $.clock.every(REFRESH_MS, () => void refresh($))
    await $.command.register({
      name: 'notes',
      description: 'Show or hide the Project notes pane; add or remove notes, or set what Claude records (/notes help)',
    })
    void $.ui.open({ id: PANE, title: TITLE })

    return next(e)
  })

  on('command.run', { command: 'notes' }, async ($, e) => {
    const args = (e.args ?? '').trim()
    const verb = args.split(/\s+/)[0] ?? ''
    const tail = args.slice(verb.length).trim()

    if (verb === 'help') return { text: USAGE }
    if (verb === 'record') return { text: await record($, tail) }
    if (verb === 'add' || verb === 'remove' || verb === 'rm') {
      const { scope, rest } = scopeOf(tail)
      const at = rest.indexOf(':')
      const label = (verb === 'add' ? rest.slice(0, Math.max(at, 0)) : rest).trim()
      const value = verb === 'add' ? rest.slice(at + 1).trim() : ''
      if (label === '' || (verb === 'add' && value === '')) return { text: `Usage:\n${USAGE}` }
      return { text: await save($, scope, label, value) }
    }
    if (verb !== '') return { text: `Unknown: /notes ${verb}\n${USAGE}` }

    const isOpen = (await $.ui.panes()).some(p => p.id === PANE)
    if (isOpen) {
      await $.ui.close({ id: PANE })
      return { text: 'Project notes pane closed.' }
    }
    await refresh($)
    await $.ui.open({ id: PANE, title: TITLE })
    // The surface, not the mod, decides placement: only the fullscreen layout
    // docks a pane as a right-hand sidebar; the main screen shows it inline.
    const { isFullscreen, columns } = e.presentation ?? { isFullscreen: false, columns: 0 }
    if (!isFullscreen) {
      return { text: 'Project notes pane opened inline. It docks on the right only in the fullscreen layout (unset CLAUDE_CODE_NO_FLICKER=0, or run outside tmux).' }
    }
    if (columns < 110) {
      return { text: `Project notes pane opened inline. It docks on the right from 110 columns; this terminal is ${columns}.` }
    }
    return { text: 'Project notes pane opened.' }
  }).catch(($, e, next) => ({ text: `project-notes: ${next.error.message}` }))

  on('tool.call', { tool: TOOL }, async ($, e) => {
    // The tool's arguments arrive beside `tool` on the event itself.
    const input = e as unknown as { label?: unknown; value?: unknown; scope?: unknown }
    const label = String(input.label ?? '').trim()
    const value = String(input.value ?? '').trim()
    const scope = (input.scope ?? 'session') as Scope
    if (label === '') return { deny: 'label is required' }
    if (!['session', 'local', 'project'].includes(scope)) return { deny: 'scope must be session, local or project' }

    return { result: await save($, scope, label, value) }
  }).catch(($, e, next) => ({ deny: `project-notes: the note was not saved: ${next.error.message}` }))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Link } = $.ui.resolve(e)
    const p = await read($, project)
    const session = await read($, sessionNotes)

    // One line a note: `Label - value`, a URL value a link. `/notes remove` takes one off.
    const row = (note: Note, scope: Scope) => (
      <Box>
        <Text bold>{note.label}</Text>
        <Text dimColor> - </Text>
        {isUrl(note.value) ? <Link href={note.value} /> : <Text>{note.value}</Text>}
        {scope === 'local' && <Text dimColor> (this machine)</Text>}
      </Box>
    )

    return (
      <Box flexDirection="column">
        <Text bold underline>Project</Text>
        {p.error !== undefined && <Text color="red">{p.error}</Text>}
        {p.record !== '' && (
          <Box marginBottom={1}>
            <Text dimColor>Claude records: {p.record}</Text>
          </Box>
        )}
        {p.shared.length + p.local.length === 0 && (
          <Text dimColor>None yet. Shared notes live in {SHARED_FILE}, this machine's in {LOCAL_FILE}.</Text>
        )}
        {p.shared.map(n => row(n, 'project'))}
        {p.local.map(n => row(n, 'local'))}
        <Box marginTop={1}>
          <Text bold underline>Session</Text>
        </Box>
        {session.length === 0 && <Text dimColor>None yet. Ask Claude to note a URL or path.</Text>}
        {session.map(n => row(n, 'session'))}
      </Box>
    )
  })
}
