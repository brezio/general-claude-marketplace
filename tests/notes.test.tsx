import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'project-notes',
  component: 'Pane',
  requestId: 'project-notes',
  props: {
    title: 'Project notes',
    isFocused: false,
    bodyColumns: 40,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const TOOL = 'mcp__project-notes__note'
const ROOT = '/repo'

// Stands for the engine: a git repo at ROOT and an in-memory file system.
function engine(on: Parameters<Parameters<typeof test>[1]>[1], files: Map<string, string>, described: string[] = []) {
  let open = false
  on('tool.register', (_, e: any) => { described.push(e.description); return { value: { tool: TOOL } } })
  on('command.register', () => ({ value: { command: 'notes' } }))
  on('ui.open', () => { open = true; return { value: { isPlaced: true } } })
  on('ui.close', () => { open = false; return { value: undefined } })
  on('ui.panes', () => ({ value: open ? [{ id: 'project-notes', title: 'Project notes', isShown: true, isFocused: false, isPlaced: true }] : [] }))
  on('clock.every', () => ({ value: undefined }))
  on('process.run', (_, e: any) => ({
    value: e.argv[1] === 'rev-parse'
      ? { exitCode: 0, stdout: `${ROOT}\n`, stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
      : { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('fs.exists', (_, e: any) => ({ value: files.has(e.path) }))
  on('fs.read', (_, e: any) => ({ value: files.get(e.path) }))
  on('fs.write', (_, e: any) => { files.set(e.path, e.text); return { value: undefined } })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
}

test('the pane shows project and session notes in their own sections', async ($, on) => {
  const files = new Map([[`${ROOT}/.claude/project-notes.json`, JSON.stringify({
    record: 'Note the app URL.',
    notes: [{ label: 'Staging', value: 'https://staging.example.com' }],
  })]])
  engine(on, files)
  await $.session.start({ cwd: `${ROOT}/src`, surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: TOOL, label: 'App', value: 'http://127.0.0.1:4000' } as never)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
  const at = (s: string) => texts.findIndex(t => t === s)
  expect(at('Project')).toBeLessThan(at('Staging'))
  expect(at('Staging')).toBeLessThan(at('Session'))
  expect(at('Session')).toBeLessThan(at('App'))
  await ui.unmount()
})

test('local and project notes are written to their files, and local warns when not ignored', async ($, on) => {
  const files = new Map<string, string>()
  engine(on, files)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })

  const local = await $.tool.call({ tool: TOOL, label: 'Mailpit', value: 'http://127.0.0.1:8025', scope: 'local' } as never)
  expect(String(local.result)).toMatch(/not ignored by git/)
  await $.tool.call({ tool: TOOL, label: 'Docs', value: 'docs/', scope: 'project' } as never)
  await $.tool.call({ tool: TOOL, label: 'Docs', value: 'docs/architecture.md', scope: 'project' } as never)

  expect(JSON.parse(files.get(`${ROOT}/.claude/project-notes.local.json`)!).notes).toEqual([{ label: 'Mailpit', value: 'http://127.0.0.1:8025' }])
  expect(JSON.parse(files.get(`${ROOT}/.claude/project-notes.json`)!).notes).toEqual([{ label: 'Docs', value: 'docs/architecture.md' }])

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /this machine/ })).toBeTruthy()
  await ui.unmount()

  await $.tool.call({ tool: TOOL, label: 'Docs', value: '', scope: 'project' } as never)
  expect(JSON.parse(files.get(`${ROOT}/.claude/project-notes.json`)!).notes).toEqual([])
})

test("the project's record and the notes reach Claude through the tool's description", async ($, on) => {
  const files = new Map([[`${ROOT}/.claude/project-notes.json`, JSON.stringify({ record: 'Note the Mailpit URL.' })]])
  const described: string[] = []
  engine(on, files, described)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  expect(described.at(-1)).toMatch(/Note the Mailpit URL\./)
  await $.tool.call({ tool: TOOL, label: 'App', value: 'http://127.0.0.1:4000' } as never)
  expect(described.at(-1)).toMatch(/- App: http:\/\/127\.0\.0\.1:4000/)
})

test('/notes adds and removes notes in each scope', async ($, on) => {
  const files = new Map<string, string>()
  engine(on, files)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })

  expect((await $.command.run({ command: 'notes', args: 'add App: http://127.0.0.1:4000' })).text).toMatch(/for this session/)
  await $.command.run({ command: 'notes', args: 'add --local Mailpit: http://127.0.0.1:8025' })
  await $.command.run({ command: 'notes', args: 'add --project Design doc: docs/architecture.md' })
  expect(JSON.parse(files.get(`${ROOT}/.claude/project-notes.json`)!).notes).toEqual([{ label: 'Design doc', value: 'docs/architecture.md' }])
  expect(JSON.parse(files.get(`${ROOT}/.claude/project-notes.local.json`)!).notes).toEqual([{ label: 'Mailpit', value: 'http://127.0.0.1:8025' }])

  let ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: 'App' })).toBeTruthy()
  await ui.unmount()
  await $.command.run({ command: 'notes', args: 'remove App' })
  await $.command.run({ command: 'notes', args: 'rm --project Design doc' })
  ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: 'App' })).toBeFalsy()
  await ui.unmount()
  expect(JSON.parse(files.get(`${ROOT}/.claude/project-notes.json`)!).notes).toEqual([])

  expect((await $.command.run({ command: 'notes', args: 'add no colon here' })).text).toMatch(/Usage/)
  expect((await $.command.run({ command: 'notes', args: 'frobnicate' })).text).toMatch(/Unknown/)
})

test('/notes record sets, shows and clears the instructions, keeping the notes', async ($, on) => {
  const shared = `${ROOT}/.claude/project-notes.json`
  const files = new Map([[shared, JSON.stringify({ notes: [{ label: 'Staging', value: 'https://s.example.com' }] })]])
  const described: string[] = []
  engine(on, files, described)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })

  await $.command.run({ command: 'notes', args: 'record Note every dev server URL.' })
  expect(JSON.parse(files.get(shared)!)).toEqual({ record: 'Note every dev server URL.', notes: [{ label: 'Staging', value: 'https://s.example.com' }] })
  expect(described.at(-1)).toMatch(/Note every dev server URL\./)
  await $.command.run({ command: 'notes', args: 'record --local Also note the Mailpit URL.' })
  expect(described.at(-1)).toMatch(/Note every dev server URL\.\nAlso note the Mailpit URL\./)
  expect((await $.command.run({ command: 'notes', args: 'record' })).text).toMatch(/Note every dev server URL/)

  await $.command.run({ command: 'notes', args: 'record --clear' })
  expect(JSON.parse(files.get(shared)!)).toEqual({ notes: [{ label: 'Staging', value: 'https://s.example.com' }] })
  expect((await $.command.run({ command: 'notes', args: 'record' })).text).toMatch(/No instructions/)
})

test('/notes toggles the pane', async ($, on) => {
  engine(on, new Map())
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  expect((await $.command.run({ command: 'notes' })).text).toMatch(/closed/)
  const docked = await $.command.run({ command: 'notes', presentation: { isFullscreen: true, columns: 200 } } as never)
  expect(docked.text).toBe('Project notes pane opened.')
})
