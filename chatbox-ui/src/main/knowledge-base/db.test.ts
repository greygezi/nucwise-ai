import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ root: '', handlers: new Map<string, (...args: any[]) => Promise<any>>() }))
vi.mock('electron', () => ({
  app: { getPath: () => state.root },
  ipcMain: { handle: (name: string, fn: (...args: any[]) => Promise<any>) => state.handlers.set(name, fn) },
}))
vi.mock('./file-loaders', () => ({ readChunks: vi.fn(), searchKnowledgeBase: vi.fn() }))
vi.mock('./parsers', () => ({ MineruParser: vi.fn(), testMineruConnection: vi.fn() }))
vi.mock('../adapters/sentry', () => ({ sentry: { withScope: vi.fn(), captureException: vi.fn() } }))
vi.mock('../util', () => ({ getLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }))
let database: typeof import('./db')
beforeAll(async () => {
  state.root = fs.mkdtempSync(path.join(os.tmpdir(), 'nucwise-review-'))
  database = await import('./db')
  await database.initializeDatabase()
  const { registerKnowledgeBaseHandlers } = await import('./ipc-handlers')
  registerKnowledgeBaseHandlers()
})
afterAll(() => {
  database?.getDatabase().close()
  // Windows libsql may retain the file until the test worker exits.
  try {
    fs.rmSync(state.root, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 })
  } catch (error) {
    if (!['EPERM', 'EBUSY'].includes((error as NodeJS.ErrnoException).code || '')) throw error
  }
})

it('rolls back vector and metadata deletion together and serializes writes', async () => {
  const db = database.getDatabase()
  await db.execute("INSERT INTO knowledge_base (id, name, embedding_model) VALUES (1, 'test', 'test')")
  await db.execute(
    "INSERT INTO kb_file (id, kb_id, filename, filepath, mime_type) VALUES (7, 1, 'test.txt', 'unused', 'text/plain')"
  )
  await db.execute('CREATE TABLE kb_1 (metadata TEXT)')
  await db.execute(`INSERT INTO kb_1 VALUES ('{"fileId":7}')`)
  await db.execute(
    "CREATE TRIGGER fail_file_delete BEFORE DELETE ON kb_file BEGIN SELECT RAISE(ABORT, 'test blocked'); END"
  )
  const deleteFile = state.handlers.get('kb:file:delete')!
  expect(await deleteFile({}, 7)).toMatchObject({ success: false })
  expect((await db.execute('SELECT * FROM kb_1')).rows).toHaveLength(1)
  expect((await db.execute('SELECT * FROM kb_file')).rows).toHaveLength(1)
  await db.execute('DROP TRIGGER fail_file_delete')
  expect(await deleteFile({}, 7)).toEqual({ success: true })
  expect((await db.execute('SELECT * FROM kb_1')).rows).toHaveLength(0)
  expect((await db.execute('SELECT * FROM kb_file')).rows).toHaveLength(0)
  const events: string[] = []
  await Promise.all([
    database.withTransaction(async () => {
      events.push('start')
      await new Promise((r) => setTimeout(r, 5))
      events.push('end')
    }),
    database.runVectorWrite(async () => {
      events.push('vector')
    }),
  ])
  expect(events).toEqual(['start', 'end', 'vector'])
  expect(await state.handlers.get('kb:delete')!({}, 1)).toEqual({ success: true })
  expect((await db.execute("SELECT name FROM sqlite_master WHERE name = 'kb_1'")).rows).toHaveLength(0)
})

it('deletes an unindexed file and an empty knowledge base', async () => {
  const db = database.getDatabase()
  await db.execute("INSERT INTO knowledge_base (id, name, embedding_model) VALUES (2, 'empty', 'test')")
  await db.execute(
    "INSERT INTO kb_file (id, kb_id, filename, filepath, mime_type) VALUES (8, 2, 'test.txt', 'unused', 'text/plain')"
  )
  expect(await state.handlers.get('kb:file:delete')!({}, 8)).toEqual({ success: true })
  expect(await state.handlers.get('kb:delete')!({}, 2)).toEqual({ success: true })
})
