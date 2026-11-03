/**
 * dsh-recall — host half.
 *
 * Builds an in-memory, CJK-friendly index over the semantic text of every past
 * conversation (user/assistant messages, tool calls & results, todos) and
 * serves it to the browser half over a small JSON API on the app's own origin.
 *
 * Why not SQLite FTS5: the shipped `unicode61` tokenizer splits on whitespace,
 * so a run of Chinese characters is one token and a partial query like 「论文」
 * never matches 「毕业论文」. Recall does literal substring matching in JS,
 * which behaves identically for Chinese, Japanese, English and code.
 */

const API_PREFIX = '/dsh-recall/api'
const MAX_DOC_CHARS = 4000
const MAX_HITS = 300
const REBUILD_TTL_MS = 5 * 60 * 1000
const BUILD_CONCURRENCY = 4
const SHARED_STATE = Symbol.for('dsh-recall.index')
const STATE_VERSION = 2

const SEARCHABLE_TYPES = ['user/message', 'assistant/message', 'tool/call', 'tool/result', 'todo/write']

const TYPE_LABEL = {
	'user/message': 'user',
	'assistant/message': 'assistant',
	'tool/call': 'tool',
	'tool/result': 'result',
	'todo/write': 'todo'
}

export const name = 'dsh-recall'
export const inject = ['webServer']

function basename(p) {
	if (typeof p !== 'string' || p.length === 0) return ''
	const parts = p.split(/[\\/]+/).filter(Boolean)
	return parts.length === 0 ? p : parts[parts.length - 1]
}

function clampText(text) {
	if (text.length <= MAX_DOC_CHARS) return text
	return text.slice(0, MAX_DOC_CHARS)
}

function collapse(text) {
	return text.replace(/\s+/g, ' ').trim()
}

function makeSnippet(lower, original, needle, terms) {
	let idx = needle.length > 0 ? lower.indexOf(needle) : -1
	if (idx < 0) {
		for (const term of terms) {
			const found = lower.indexOf(term)
			if (found >= 0 && (idx < 0 || found < idx)) idx = found
		}
	}
	if (idx < 0) return collapse(original).slice(0, 200)
	const start = Math.max(0, idx - 60)
	const end = Math.min(original.length, idx + Math.max(needle.length, 40) + 140)
	const head = start > 0 ? '…' : ''
	const tail = end < original.length ? '…' : ''
	return `${head}${collapse(original.slice(start, end))}${tail}`
}

function countOccurrences(haystack, needle) {
	if (needle.length === 0) return 0
	let count = 0
	let from = 0
	for (;;) {
		const at = haystack.indexOf(needle, from)
		if (at < 0) break
		count++
		from = at + needle.length
		if (count > 200) break
	}
	return count
}

function relativeTitle(session) {
	if (typeof session.title === 'string' && session.title.trim().length > 0) return session.title.trim()
	if (typeof session.firstUserText === 'string' && session.firstUserText.trim().length > 0) {
		return collapse(session.firstUserText).slice(0, 80)
	}
	return '(未命名会话)'
}

export function apply(ctx) {
	const logger = ctx.logger ?? console
	// The index survives Host plugin reloads (file edits, profile recomposition):
	// a reload replaces the module instance, not the process, and rebuilding a
	// 3000-event corpus for every edit would stack up concurrent scans.
	// Bump STATE_VERSION when the published shape changes.
	const state = (function () {
		const cached = globalThis[SHARED_STATE]
		if (cached !== undefined && cached.version === STATE_VERSION) return cached
		const fresh = {
			version: STATE_VERSION,
			sessions: [],
			projects: [],
			docCount: 0,
			builtAt: 0,
			building: null,
			lastBuildMs: 0,
			lastError: null
		}
		globalThis[SHARED_STATE] = fresh
		return fresh
	})()

	function sessionQuery() {
		return ctx.get('sessionQuery')
	}

	logger.info('dsh-recall: host applied')

	function projectSummary() {
		const byPath = new Map()
		for (const session of state.sessions) {
			const cwd = session.cwd ?? ''
			const key = cwd
			const entry = byPath.get(key) ?? {
				cwd,
				name: basename(cwd) || '(未知目录)',
				sessions: 0,
				docs: 0,
				lastTime: 0
			}
			entry.sessions++
			entry.docs += session.docs.length
			entry.lastTime = Math.max(entry.lastTime, session.lastTime)
			byPath.set(key, entry)
		}
		return [...byPath.values()].sort((a, b) => b.lastTime - a.lastTime)
	}

	async function mapLimit(items, limit, worker) {
		const results = new Array(items.length)
		let cursor = 0
		const runners = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
			for (;;) {
				const index = cursor++
				if (index >= items.length) return
				results[index] = await worker(items[index], index)
			}
		})
		await Promise.all(runners)
		return results
	}

	async function buildIndex() {
		const sq = sessionQuery()
		if (sq === undefined) throw new Error('session-query 服务不可用（未挂载 @deepseek-ai/dsh-session-query）')
		const startedAt = Date.now()
		const records = await sq.listSessions()
		const targets = records.filter((record) => record.header.cwd !== undefined && record.header.parentSession === undefined)

		const collected = []
		const publish = () => {
			collected.sort((a, b) => b.lastTime - a.lastTime)
			state.sessions = collected.slice()
			state.docCount = collected.reduce((total, session) => total + session.docs.length, 0)
			state.projects = projectSummary()
		}

		await mapLimit(targets, BUILD_CONCURRENCY, async (record) => {
			const header = record.header
			try {
				const docs = await sq.filterEvents(header.id, [
					{ kind: 'surface', values: ['current'] },
					{ kind: 'type', values: SEARCHABLE_TYPES }
				])
				const indexed = []
				let firstUserText = ''
				let lastTime = header.createdAt ?? 0
				for (const doc of docs) {
					const text = typeof doc.text === 'string' ? doc.text : ''
					if (text.length === 0) continue
					const trimmed = clampText(text)
					if (firstUserText.length === 0 && doc.type === 'user/message') firstUserText = trimmed
					lastTime = Math.max(lastTime, doc.time ?? 0)
					indexed.push({
						seq: doc.seq,
						type: doc.type,
						time: doc.time ?? 0,
						text: trimmed,
						lower: trimmed.toLowerCase()
					})
				}
				if (indexed.length === 0) return
				collected.push({
					id: header.id,
					cwd: header.cwd ?? '',
					createdAt: header.createdAt ?? 0,
					title: '',
					firstUserText,
					lastTime,
					docs: indexed
				})
				// Publish as soon as a session is ready: an early search then
				// returns partial results instead of waiting for the whole corpus.
				publish()
			} catch (error) {
				logger.warn(`dsh-recall: skipping session ${header.id}: ${String(error)}`)
			}
		})

		publish()
		state.builtAt = Date.now()
		state.lastBuildMs = state.builtAt - startedAt
		state.lastError = null
		logger.info(
			`dsh-recall: indexed ${state.sessions.length} sessions / ${state.docCount} events in ${state.lastBuildMs}ms`
		)
	}

	async function ensureIndex(force) {
		if (state.building !== null) return state.building
		const fresh = state.builtAt > 0 && Date.now() - state.builtAt < REBUILD_TTL_MS
		if (!force && fresh) return
		state.building = (async () => {
			try {
				await buildIndex()
			} catch (error) {
				state.lastError = String(error instanceof Error ? error.message : error)
				logger.warn(`dsh-recall: index build failed: ${state.lastError}`)
			} finally {
				state.building = null
			}
		})()
		return state.building
	}

	function search(rawQuery, options) {
		const query = (rawQuery ?? '').trim()
		if (query.length === 0) return { hits: [], matched: 0, scanned: 0 }
		const needle = query.toLowerCase()
		const terms = needle.split(/\s+/).filter(Boolean)
		const phraseMatch = terms.length > 1
		const projectFilter = options.project ?? ''
		const minTime = options.days > 0 ? Date.now() - options.days * 86400000 : 0
		const limit = Math.min(Math.max(1, options.limit ?? 120), MAX_HITS)

		const hits = []
		let matched = 0
		let scanned = 0
		for (const session of state.sessions) {
			if (projectFilter.length > 0 && session.cwd !== projectFilter) continue
			for (const doc of session.docs) {
				scanned++
				if (minTime > 0 && doc.time < minTime) continue
				let score = 0
				let ok = false
				if (phraseMatch) {
					ok = true
					for (const term of terms) {
						if (doc.lower.indexOf(term) < 0) {
							ok = false
							break
						}
					}
					if (ok) score = countOccurrences(doc.lower, terms[0])
				} else {
					const occurrences = countOccurrences(doc.lower, needle)
					ok = occurrences > 0
					score = occurrences
				}
				if (!ok) continue
				matched++
				hits.push({
					sessionId: session.id,
					title: relativeTitle(session),
					project: basename(session.cwd) || '(未知目录)',
					cwd: session.cwd,
					sessionTime: session.lastTime,
					seq: doc.seq,
					type: doc.type,
					kind: TYPE_LABEL[doc.type] ?? doc.type,
					time: doc.time,
					score,
					snippet: makeSnippet(doc.lower, doc.text, phraseMatch ? terms[0] : needle, terms)
				})
			}
		}
		hits.sort((a, b) => b.score - a.score || b.time - a.time)
		return { hits: hits.slice(0, limit), matched, scanned }
	}

	function context(sessionId, seq, before, after) {
		const session = state.sessions.find((entry) => entry.id === sessionId)
		if (session === undefined) return null
		const at = session.docs.findIndex((doc) => doc.seq === seq)
		if (at < 0) return null
		const from = Math.max(0, at - before)
		const to = Math.min(session.docs.length, at + after + 1)
		return {
			session: {
				id: session.id,
				title: relativeTitle(session),
				project: basename(session.cwd),
				cwd: session.cwd,
				lastTime: session.lastTime
			},
			events: session.docs.slice(from, to).map((doc) => ({
				seq: doc.seq,
				type: doc.type,
				kind: TYPE_LABEL[doc.type] ?? doc.type,
				time: doc.time,
				text: doc.text,
				focus: doc.seq === seq
			}))
		}
	}

	function sendJson(res, status, payload) {
		try {
			res.writeHead(status, {
				'content-type': 'application/json; charset=utf-8',
				'cache-control': 'no-store'
			})
			res.end(JSON.stringify(payload))
		} catch {
			try {
				res.destroy()
			} catch {
				/* ignore */
			}
		}
	}

	function statusPayload() {
		return {
			ok: true,
			index: {
				sessions: state.sessions.length,
				docs: state.docCount,
				builtAt: state.builtAt,
				building: state.building !== null,
				buildMs: state.lastBuildMs,
				stale: state.builtAt > 0 && Date.now() - state.builtAt >= REBUILD_TTL_MS,
				error: state.lastError
			},
			projects: state.projects
		}
	}

	async function handler(req, res) {
		if (req.method !== 'GET' && req.method !== 'POST') {
			res.writeHead(405, { allow: 'GET, POST' }).end()
			return
		}
		const url = new URL(req.url ?? '/', 'http://dsh-recall.invalid')
		const route = url.pathname.startsWith(API_PREFIX) ? url.pathname.slice(API_PREFIX.length) : url.pathname
		if (req.method === 'POST' && route !== '/log') req.resume()
		try {
			switch (route) {
				case '/status': {
					if (state.sessions.length === 0) void ensureIndex(false)
					sendJson(res, 200, statusPayload())
					return
				}
				case '/refresh': {
					await ensureIndex(true)
					sendJson(res, 200, statusPayload())
					return
				}
				case '/log': {
					let body = ''
					for await (const chunk of req) {
						body += chunk
						if (body.length > 8192) break
					}
					try {
						const payload = JSON.parse(body)
						logger.info(`dsh-recall[client/${payload.level ?? 'info'}]: ${String(payload.msg ?? '').slice(0, 500)}`)
					} catch {
						logger.info(`dsh-recall[client]: ${body.slice(0, 500)}`)
					}
					sendJson(res, 200, { ok: true })
					return
				}
				case '/search': {
					const query = url.searchParams.get('q') ?? ''
					if (query.trim().length === 0) {
						sendJson(res, 200, { ok: true, tookMs: 0, hits: [], matched: 0, scanned: 0, index: statusPayload().index })
						return
					}
					const startedAt = Date.now()
					if (state.sessions.length === 0) {
						await ensureIndex(false)
					} else if (state.builtAt > 0 && Date.now() - state.builtAt >= REBUILD_TTL_MS) {
						// Serve the current index immediately; refresh in the background so
						// typing never waits for a full re-scan.
						void ensureIndex(true)
					}
					if (state.sessions.length === 0) {
						sendJson(res, state.lastError === null ? 200 : 503, {
							ok: state.lastError === null,
							error: state.lastError,
							hits: [],
							matched: 0,
							scanned: 0,
							index: statusPayload().index
						})
						return
					}
					const result = search(query, {
						project: url.searchParams.get('project') ?? '',
						days: Number.parseInt(url.searchParams.get('days') ?? '0', 10) || 0,
						limit: Number.parseInt(url.searchParams.get('limit') ?? '120', 10) || 120
					})
					logger.info(
						`dsh-recall: search "${query}" -> ${result.matched} matched, ${result.hits.length} returned, ${Date.now() - startedAt}ms`
					)
					sendJson(res, 200, {
						ok: true,
						tookMs: Date.now() - startedAt,
						hits: result.hits,
						matched: result.matched,
						scanned: result.scanned,
						index: statusPayload().index
					})
					return
				}
				case '/context': {
					if (state.sessions.length === 0) await ensureIndex(false)
					const sessionId = url.searchParams.get('sessionId') ?? ''
					const seq = Number.parseInt(url.searchParams.get('seq') ?? '', 10)
					const before = Math.min(Math.max(0, Number.parseInt(url.searchParams.get('before') ?? '2', 10) || 0), 10)
					const after = Math.min(Math.max(0, Number.parseInt(url.searchParams.get('after') ?? '2', 10) || 0), 10)
					const payload = Number.isFinite(seq) ? context(sessionId, seq, before, after) : null
					sendJson(res, payload === null ? 404 : 200, payload === null ? { ok: false, error: 'not-indexed' } : { ok: true, ...payload })
					return
				}
				default: {
					sendJson(res, 404, { ok: false, error: 'not-found' })
				}
			}
		} catch (error) {
			logger.warn(`dsh-recall: request failed: ${String(error)}`)
			sendJson(res, 500, { ok: false, error: String(error instanceof Error ? error.message : error) })
		}
	}

	ctx.effect(
		() => ctx.webServer.register({ kind: 'prefix', path: API_PREFIX, handler }),
		'dsh-recall: JSON API'
	)
}
