// dsh-recall browser bundle — a global "find anything I did before" panel.
//
// Renders inside the DSH web client as a sidebar panel row plus a root main
// panel (key "recall"). Talks to the host half over same-origin JSON routes.
window.__ModuleLoader__.load({
	id: 'dsh-recall',
	factory: (require) => {
		var module = { exports: {} }
		var exports = module.exports
		Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

		var React = require('react')
		var h = React.createElement
		var useState = React.useState
		var useEffect = React.useEffect
		var useRef = React.useRef
		var useMemo = React.useMemo
		var useCallback = React.useCallback

		var PANEL_ID = 'recall'
		var API = '/dsh-recall/api'
		var SAVED = (function () {
			try {
				return JSON.parse(sessionStorage.getItem('dsh-recall.panel') || '{}') || {}
			} catch (e) {
				return {}
			}
		})()

		function report(level, msg) {
			try {
				fetch(API + '/log', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ level: level, msg: String(msg).slice(0, 800) })
				}).catch(function () {})
			} catch (e) {}
		}

		window.addEventListener('error', function (event) {
			report('error', (event.message || 'error') + ' @' + (event.filename || '') + ':' + (event.lineno || 0))
		})
		window.addEventListener('unhandledrejection', function (event) {
			var reason = event.reason
			report('error', 'unhandled rejection: ' + (reason && reason.message ? reason.message : String(reason)))
		})

		function qs(params) {
			var parts = []
			Object.keys(params).forEach(function (key) {
				var value = params[key]
				if (value === undefined || value === null || value === '') return
				parts.push(key + '=' + encodeURIComponent(value))
			})
			return parts.length === 0 ? '' : '?' + parts.join('&')
		}

		function getJson(path, params, signal) {
			return fetch(API + path + qs(params || {}), {
				signal: signal,
				headers: { accept: 'application/json' }
			}).then(function (response) {
				return response.json().catch(function () { return {} }).then(function (body) {
					if (!response.ok || body.ok === false) {
						throw new Error(body.error || 'HTTP ' + response.status)
					}
					return body
				})
			})
		}

		function postJson(path, payload) {
			return fetch(API + path, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(payload || {})
			}).then(function (response) {
				return response.json().catch(function () { return {} })
			})
		}

		function baseName(path) {
			if (typeof path !== 'string' || path.length === 0) return ''
			var parts = path.split(/[\\/]+/).filter(Boolean)
			return parts.length === 0 ? path : parts[parts.length - 1]
		}

		function pad(value) {
			return value < 10 ? '0' + value : String(value)
		}

		function relTime(timestamp) {
			if (!timestamp) return ''
			var diff = Date.now() - timestamp
			if (diff < 0) diff = 0
			var minute = 60000
			var hour = 60 * minute
			var day = 24 * hour
			if (diff < minute) return '刚刚'
			if (diff < hour) return Math.floor(diff / minute) + ' 分钟前'
			if (diff < day) return Math.floor(diff / hour) + ' 小时前'
			if (diff < 7 * day) return Math.floor(diff / day) + ' 天前'
			var date = new Date(timestamp)
			return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
		}

		function clock(timestamp) {
			if (!timestamp) return ''
			var date = new Date(timestamp)
			return pad(date.getHours()) + ':' + pad(date.getMinutes())
		}

		function highlight(text, terms) {
			if (!text) return text
			if (!terms || terms.length === 0) return text
			var lower = text.toLowerCase()
			var spans = []
			var i = 0
			while (i < text.length) {
				var best = -1
				var bestLen = 0
				for (var t = 0; t < terms.length; t++) {
					var at = lower.indexOf(terms[t], i)
					if (at >= 0 && (best < 0 || at < best)) {
						best = at
						bestLen = terms[t].length
					}
				}
				if (best < 0) break
				if (best > i) spans.push(text.slice(i, best))
				spans.push(h('mark', { key: 'm' + best, className: 'dshr-mark' }, text.slice(best, best + bestLen)))
				i = best + bestLen
			}
			if (i < text.length) spans.push(text.slice(i))
			return spans
		}

		function termsOf(query) {
			return (query || '')
				.toLowerCase()
				.split(/\s+/)
				.filter(function (term) { return term.length > 0 })
		}

		var KIND_LABEL = {
			user: '我',
			assistant: 'AI',
			tool: '工具',
			result: '结果',
			todo: '清单'
		}

		var TYPE_HINT = {
			'user/message': '我的消息',
			'assistant/message': 'AI 回复',
			'tool/call': '工具调用',
			'tool/result': '工具结果',
			'todo/write': '任务清单'
		}

		// ── styles ────────────────────────────────────────────────────────────
		var CSS = [
			'.dshr-root{display:flex;flex-direction:column;height:100%;min-height:0;color:var(--dsw-alias-label-primary,#e8e8e8);font-size:14px}',
			'.dshr-head{display:flex;flex-direction:column;gap:10px;padding:18px 22px 12px;flex:none}',
			'.dshr-titlebar{display:flex;align-items:baseline;gap:10px}',
			'.dshr-title{font-size:21px;font-weight:600;letter-spacing:.2px}',
			'.dshr-sub{font-size:12px;color:var(--dsw-alias-label-secondary,#9096a0)}',
			'.dshr-searchrow{display:flex;align-items:center;gap:10px}',
			'.dshr-search{display:flex;align-items:center;flex:1;gap:8px;padding:0 12px;height:42px;border-radius:10px;background:var(--dsw-alias-bg-layer-1,rgba(255,255,255,.05));border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.10));transition:border-color .15s}',
			'.dshr-search:focus-within{border-color:var(--dsw-alias-brand-primary,#4f8cff)}',
			'.dshr-search svg{flex:none;opacity:.55}',
			'.dshr-input{flex:1;min-width:0;background:transparent;border:0;outline:0;color:inherit;font-size:16px;line-height:1.2;font-family:inherit}',
			'.dshr-input::placeholder{color:var(--dsw-alias-label-secondary,#9096a0)}',
			'.dshr-kbd{font-size:11px;color:var(--dsw-alias-label-secondary,#9096a0);border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.12));border-radius:5px;padding:1px 5px;white-space:nowrap}',
			'.dshr-filters{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
			'.dshr-select{appearance:none;background-color:var(--dsw-alias-bg-layer-1,rgba(255,255,255,.05));background-image:url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'8\' height=\'5\'%3E%3Cpath d=\'M0 0l4 5 4-5z\' fill=\'%239aa0a6\'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 7px center;color:inherit;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.10));border-radius:8px;padding:5px 22px 5px 9px;font-size:12.5px;font-family:inherit;cursor:pointer;max-width:260px;text-overflow:ellipsis}',
			'.dshr-ghost{background:transparent;color:var(--dsw-alias-label-secondary,#9096a0);border:1px solid transparent;border-radius:7px;padding:5px 9px;font-size:12.5px;font-family:inherit;cursor:pointer}',
			'.dshr-ghost:hover{background:var(--dsw-alias-bg-layer-1,rgba(255,255,255,.06));color:inherit}',
			'.dshr-ghost[data-on="1"]{background:var(--dsw-alias-bg-layer-2,rgba(255,255,255,.10));color:inherit}',
			'.dshr-body{display:flex;flex:1;min-height:0;border-top:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.07))}',
			'.dshr-list{flex:1;min-width:0;overflow-y:auto;padding:8px 10px 40px 16px}',
			'.dshr-detail{width:380px;flex:none;border-left:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.07));display:flex;flex-direction:column;min-height:0;background:var(--dsw-alias-bg-layer-1,rgba(255,255,255,.02))}',
			'.dshr-group{margin:6px 0 14px}',
			'.dshr-grouphead{display:flex;align-items:center;gap:8px;padding:8px 8px 6px}',
			'.dshr-gtitle{font-weight:600;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:52%}',
			'.dshr-gmeta{font-size:11.5px;color:var(--dsw-alias-label-secondary,#9096a0);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
			'.dshr-gopen{margin-left:auto;flex:none;background:transparent;border:0;color:var(--dsw-alias-label-secondary,#9096a0);cursor:pointer;font-size:12px;padding:3px 8px;border-radius:6px;font-family:inherit}',
			'.dshr-gopen:hover{background:var(--dsw-alias-bg-layer-2,rgba(255,255,255,.09));color:var(--dsw-alias-brand-primary,#4f8cff)}',
			'.dshr-hit{display:flex;gap:9px;padding:9px 10px;border-radius:9px;cursor:pointer;border:1px solid transparent;align-items:flex-start}',
			'.dshr-hit:hover{background:var(--dsw-alias-bg-layer-1,rgba(255,255,255,.05))}',
			'.dshr-hit[data-sel="1"]{background:var(--dsw-alias-bg-layer-2,rgba(255,255,255,.09));border-color:var(--dsw-alias-border-l2,rgba(255,255,255,.16))}',
			'.dshr-badge{flex:none;font-size:10.5px;line-height:16px;padding:1px 6px;border-radius:5px;margin-top:1px;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.12));color:var(--dsw-alias-label-secondary,#9096a0);white-space:nowrap}',
			'.dshr-badge[data-kind="user"]{color:#7fb0ff;border-color:rgba(127,176,255,.35)}',
			'.dshr-badge[data-kind="assistant"]{color:#8fd6a8;border-color:rgba(143,214,168,.35)}',
			'.dshr-snippet{font-size:13px;line-height:1.55;color:var(--dsw-alias-label-secondary,#b9bec7);word-break:break-word;white-space:normal;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}',
			'.dshr-hit[data-sel="1"] .dshr-snippet{color:var(--dsw-alias-label-primary,#e8e8e8)}',
			'.dshr-mark{background:rgba(79,140,255,.28);color:inherit;border-radius:3px;padding:0 1px}',
			'.dshr-hitbody{min-width:0;flex:1;display:flex;flex-direction:column;gap:3px}',
			'.dshr-hitline{display:flex;align-items:center;gap:8px;font-size:11px;color:var(--dsw-alias-label-secondary,#868c96)}',
			'.dshr-dhead{flex:none;padding:14px 16px 10px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.07))}',
			'.dshr-dtitle{font-size:14.5px;font-weight:600;margin-bottom:4px;word-break:break-word}',
			'.dshr-dmeta{font-size:11.5px;color:var(--dsw-alias-label-secondary,#9096a0);display:flex;gap:8px;flex-wrap:wrap}',
			'.dshr-dbody{flex:1;overflow-y:auto;padding:12px 16px 24px;display:flex;flex-direction:column;gap:10px}',
			'.dshr-ev{border-left:2px solid var(--dsw-alias-border-l1,rgba(255,255,255,.10));padding:2px 0 2px 10px;font-size:12.5px;line-height:1.6;white-space:pre-wrap;word-break:break-word;color:var(--dsw-alias-label-secondary,#b9bec7);max-height:260px;overflow:hidden}',
			'.dshr-ev[data-focus="1"]{border-left-color:var(--dsw-alias-brand-primary,#4f8cff);color:var(--dsw-alias-label-primary,#eee);max-height:none}',
			'.dshr-evhead{display:flex;gap:6px;align-items:center;font-size:10.5px;color:var(--dsw-alias-label-secondary,#868c96);margin-bottom:2px}',
			'.dshr-empty{display:flex;flex:1;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:10px;color:var(--dsw-alias-label-secondary,#9096a0);font-size:13.5px;text-align:center;padding:40px}',
			'.dshr-empty b{color:var(--dsw-alias-label-primary,#e8e8e8);font-size:15px;font-weight:600}',
			'.dshr-chips{display:flex;gap:6px;flex-wrap:wrap;justify-content:center;max-width:560px}',
			'.dshr-chip{font-size:12px;padding:4px 10px;border-radius:20px;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.12));cursor:pointer;background:transparent;color:inherit;font-family:inherit}',
			'.dshr-chip:hover{border-color:var(--dsw-alias-brand-primary,#4f8cff);color:var(--dsw-alias-brand-primary,#4f8cff)}',
			'.dshr-status{padding:6px 4px 2px;font-size:11.5px;color:var(--dsw-alias-label-secondary,#868c96);display:flex;gap:10px;align-items:center}',
			'.dshr-spin{width:12px;height:12px;border-radius:50%;border:2px solid rgba(255,255,255,.2);border-top-color:var(--dsw-alias-brand-primary,#4f8cff);animation:dshr-spin .8s linear infinite;flex:none}',
			'@keyframes dshr-spin{to{transform:rotate(360deg)}}',
			'.dshr-error{margin:10px 16px;padding:10px 12px;border-radius:8px;background:rgba(220,80,80,.12);border:1px solid rgba(220,80,80,.35);font-size:12.5px;color:#ffb3b3;white-space:pre-wrap}',
			'.dshr-btn{font-family:inherit;font-size:12.5px;padding:6px 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.14));background:var(--dsw-alias-bg-layer-1,rgba(255,255,255,.06));color:inherit;cursor:pointer}',
			'.dshr-btn:hover{border-color:var(--dsw-alias-brand-primary,#4f8cff)}',
			'.dshr-btn[data-primary="1"]{background:var(--dsw-alias-brand-primary,#4f8cff);border-color:transparent;color:#fff}',
			'.dshr-dactions{display:flex;gap:8px;padding:0 16px 14px}',
			'@media (max-width: 1100px){.dshr-detail{display:none}}'
		].join('\n')

		// ── icons ─────────────────────────────────────────────────────────────
		function IconSearch(props) {
			var size = props.size || 16
			return h(
				'svg',
				{ width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
				h('circle', { cx: 7, cy: 7, r: 4.6, stroke: 'currentColor', strokeWidth: 1.4 }),
				h('path', { d: 'M10.6 10.6 14 14', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' })
			)
		}

		function RecallIcon() {
			return h(
				'svg',
				{ width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
				h('circle', { cx: 7, cy: 7, r: 4.6, stroke: 'currentColor', strokeWidth: 1.4 }),
				h('path', { d: 'M10.6 10.6 14 14', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' }),
				h('path', { d: 'M5 6.2h4M5 8.2h2.6', stroke: 'currentColor', strokeWidth: 1.1, strokeLinecap: 'round' })
			)
		}

		// ── detail pane ───────────────────────────────────────────────────────
		function DetailPane(props) {
			var detail = props.detail
			var loading = props.loading
			var terms = props.terms
			var openSession = props.openSession
			if (loading && !detail) {
				return h('div', { className: 'dshr-detail' }, h('div', { className: 'dshr-empty' }, h('div', { className: 'dshr-spin' }), '读取上下文…'))
			}
			if (!detail) {
				return h(
					'div',
					{ className: 'dshr-detail' },
					h('div', { className: 'dshr-empty' }, h('b', null, '选中一条结果'), '这里会显示命中的完整内容与前后文。')
				)
			}
			var session = detail.session || {}
			return h(
				'div',
				{ className: 'dshr-detail' },
				h(
					'div',
					{ className: 'dshr-dhead' },
					h('div', { className: 'dshr-dtitle' }, session.title || '(未命名会话)'),
					h(
						'div',
						{ className: 'dshr-dmeta' },
						h('span', null, session.project || baseName(session.cwd) || '未知项目'),
						session.lastTime ? h('span', null, relTime(session.lastTime)) : null
					)
				),
				h(
					'div',
					{ className: 'dshr-dbody' },
					(detail.events || []).map(function (event) {
						return h(
							'div',
							{ key: String(event.seq), className: 'dshr-ev', 'data-focus': event.focus ? '1' : '0' },
							h(
								'div',
								{ className: 'dshr-evhead' },
								h('span', null, KIND_LABEL[event.kind] || event.kind),
								h('span', null, clock(event.time)),
								event.focus ? h('span', { className: 'dshr-mark', style: { padding: '0 4px' } }, '命中') : null
							),
							highlight(event.text, terms)
						)
					})
				),
				h(
					'div',
					{ className: 'dshr-dactions' },
					h(
						'button',
						{
							className: 'dshr-btn',
							'data-primary': '1',
							onClick: function () { openSession(session.id) }
						},
						'在会话中打开'
					),
					h(
						'button',
						{
							className: 'dshr-btn',
							onClick: function () {
								var focused = (detail.events || []).filter(function (event) { return event.focus })[0]
								if (!focused) return
								try {
									navigator.clipboard.writeText(focused.text)
								} catch (e) {
									report('warn', 'clipboard failed: ' + e)
								}
							}
						},
						'复制命中内容'
					)
				)
			)
		}

		// ── main page ─────────────────────────────────────────────────────────
		function RecallPage(props) {
			var openSession = props.openSession || function () {}
			var inputRef = useRef(null)

			var [status, setStatus] = useState(null)
			var [query, setQuery] = useState(typeof SAVED.query === 'string' ? SAVED.query : '')
			var [project, setProject] = useState(typeof SAVED.project === 'string' ? SAVED.project : '')
			var [days, setDays] = useState(typeof SAVED.days === 'number' ? SAVED.days : 0)
			var [results, setResults] = useState(null)
			var [loading, setLoading] = useState(false)
			var [error, setError] = useState(null)
			var [selected, setSelected] = useState(null)
			var [detail, setDetail] = useState(null)
			var [detailLoading, setDetailLoading] = useState(false)
			var [refreshTick, setRefreshTick] = useState(0)
			var [slow, setSlow] = useState(false)

			var loadStatus = useCallback(function () {
				getJson('/status')
					.then(function (body) {
						setStatus(body)
					})
					.catch(function (cause) {
						report('warn', 'status failed: ' + cause.message)
					})
			}, [])

			useEffect(function () {
				report('info', 'panel mounted')
				loadStatus()
				var timer = setTimeout(function () {
					if (inputRef.current) inputRef.current.focus()
				}, 60)
				return function () { clearTimeout(timer) }
			}, [loadStatus])

			useEffect(function () {
				try {
					sessionStorage.setItem('dsh-recall.panel', JSON.stringify({ query: query, project: project, days: days }))
				} catch (e) {}
			}, [query, project, days])

			// debounced search
			useEffect(function () {
				var text = query.trim()
				if (text.length === 0) {
					setResults(null)
					setLoading(false)
					setSlow(false)
					setError(null)
					setSelected(null)
					setDetail(null)
					return
				}
				var controller = new AbortController()
				var slowTimer = setTimeout(function () { setSlow(true) }, 700)
				var timer = setTimeout(function () {
					setLoading(true)
					setError(null)
					getJson('/search', { q: text, project: project, days: days, limit: 150 }, controller.signal)
						.then(function (body) {
							setResults(body)
							setStatus(function (previous) {
								return previous === null ? previous : Object.assign({}, previous, { index: body.index })
							})
							var first = (body.hits || [])[0]
							setSelected(first ? { sessionId: first.sessionId, seq: first.seq } : null)
							if (first) {
								setDetail(null)
							}
							report('info', 'search "' + text + '" -> ' + body.matched + ' matched / ' + (body.hits || []).length + ' rows')
						})
						.catch(function (cause) {
							if (cause && cause.name === 'AbortError') return
							setError(cause.message || String(cause))
							setResults(null)
							report('error', 'search failed: ' + (cause && cause.message))
						})
						.then(function () {
							setLoading(false)
							setSlow(false)
							clearTimeout(slowTimer)
						})
				}, 240)
				return function () {
					clearTimeout(timer)
					clearTimeout(slowTimer)
					controller.abort()
				}
			}, [query, project, days, refreshTick])

			// detail on selection
			useEffect(function () {
				if (selected === null) {
					setDetail(null)
					return
				}
				var controller = new AbortController()
				setDetailLoading(true)
				getJson('/context', { sessionId: selected.sessionId, seq: selected.seq, before: 2, after: 3 }, controller.signal)
					.then(function (body) {
						setDetail({ session: body.session, events: body.events })
					})
					.catch(function (cause) {
						if (cause && cause.name === 'AbortError') return
						setDetail(null)
						report('warn', 'context failed: ' + (cause && cause.message))
					})
					.then(function () { setDetailLoading(false) })
				return function () { controller.abort() }
			}, [selected])

			var groups = useMemo(
				function () {
					var hits = (results && results.hits) || []
					var order = []
					var map = {}
					hits.forEach(function (hit) {
						var group = map[hit.sessionId]
						if (!group) {
							group = {
								sessionId: hit.sessionId,
								title: hit.title,
								project: hit.project,
								cwd: hit.cwd,
								sessionTime: hit.sessionTime,
								hits: []
							}
							map[hit.sessionId] = group
							order.push(group)
						}
						group.hits.push(hit)
					})
					order.forEach(function (group) {
						group.hits.sort(function (a, b) { return b.time - a.time })
					})
					return order
				},
				[results]
			)

			var flat = useMemo(
				function () {
					var out = []
					groups.forEach(function (group) {
						group.hits.forEach(function (hit) {
							out.push({ sessionId: hit.sessionId, seq: hit.seq, hit: hit, group: group })
						})
					})
					return out
				},
				[groups]
			)

			var terms = useMemo(function () { return termsOf(query) }, [query])

			var move = useCallback(
				function (delta) {
					if (flat.length === 0) return
					var index = 0
					if (selected !== null) {
						for (var i = 0; i < flat.length; i++) {
							if (flat[i].sessionId === selected.sessionId && flat[i].seq === selected.seq) {
								index = i
								break
							}
						}
					}
					var next = index + delta
					if (next < 0) next = 0
					if (next >= flat.length) next = flat.length - 1
					var target = flat[next]
					setSelected({ sessionId: target.sessionId, seq: target.seq })
					var node = document.querySelector('[data-dshr-key="' + target.sessionId + ':' + target.seq + '"]')
					if (node && node.scrollIntoView) node.scrollIntoView({ block: 'nearest' })
				},
				[flat, selected]
			)

			var onKeyDown = function (event) {
				if (event.key === 'ArrowDown') {
					event.preventDefault()
					move(1)
					return
				}
				if (event.key === 'ArrowUp') {
					event.preventDefault()
					move(-1)
					return
				}
				if (event.key === 'Enter') {
					event.preventDefault()
					if (selected !== null) openSession(selected.sessionId)
					return
				}
				if (event.key === 'Escape') {
					setQuery('')
					setResults(null)
				}
			}

			var refresh = function () {
				setRefreshTick(function (value) { return value + 1 })
				postJson('/refresh', {}).then(function (body) {
					if (body && body.ok) setStatus(body)
				})
			}

			var index = (status && status.index) || (results && results.index) || null
			var projects = (status && status.projects) || []

			var body
			if (error !== null) {
				body = h(
					'div',
					{ className: 'dshr-list' },
					h('div', { className: 'dshr-error' }, '搜索失败：' + error),
					h('div', { className: 'dshr-status' }, h('button', { className: 'dshr-btn', onClick: refresh }, '重建索引后重试'))
				)
			} else if (query.trim().length === 0) {
				body = h(
					'div',
					{ className: 'dshr-empty' },
					h('b', null, '搜索你做过的所有事'),
					h('div', null, '输入关键词（支持中文、英文、代码片段），跨全部项目与历史会话查找。'),
					projects.length > 0
						? h(
								'div',
								{ className: 'dshr-chips' },
								projects.slice(0, 8).map(function (entry) {
									return h(
										'button',
										{
											key: entry.cwd,
											className: 'dshr-chip',
											onClick: function () {
												setProject(entry.cwd)
												setTimeout(function () { if (inputRef.current) inputRef.current.focus() }, 0)
											}
										},
										entry.name + ' · ' + entry.sessions
									)
								})
							)
						: null,
					index && index.sessions > 0
						? h('div', { className: 'dshr-sub' }, '已索引 ' + index.sessions + ' 个会话 / ' + index.docs + ' 条消息')
						: null
				)
			} else if (loading && results === null) {
				body = h(
					'div',
					{ className: 'dshr-empty' },
					h('div', { className: 'dshr-spin' }),
					slow ? '首次搜索正在建立索引，请稍候…' : '搜索中…'
				)
			} else if (results !== null && (results.hits || []).length === 0) {
				body = h(
					'div',
					{ className: 'dshr-empty' },
					h('b', null, '没有找到「' + query.trim() + '」'),
					h('div', null, '试试更短的关键词、换一个说法，或把时间范围放宽。')
				)
			} else {
				body = h(
					'div',
					{ className: 'dshr-list' },
					results !== null
						? h(
								'div',
								{ className: 'dshr-status' },
								h('span', null, '命中 ' + results.matched + ' 条 · 会话 ' + groups.length + ' 个'),
								h('span', null, results.tookMs + 'ms'),
								loading ? h('span', { className: 'dshr-spin' }) : null,
								index && index.building ? h('span', null, '后台更新索引…') : null
							)
						: null,
					groups.map(function (group) {
						return h(
							'div',
							{ className: 'dshr-group', key: group.sessionId },
							h(
								'div',
								{ className: 'dshr-grouphead' },
								h('span', { className: 'dshr-gtitle', title: group.title }, group.title),
								h('span', { className: 'dshr-gmeta' }, group.project + ' · ' + relTime(group.sessionTime)),
								h(
									'button',
									{ className: 'dshr-gopen', onClick: function () { openSession(group.sessionId) } },
									'打开会话'
								)
							),
							group.hits.map(function (hit) {
								var active = selected !== null && selected.sessionId === hit.sessionId && selected.seq === hit.seq
								return h(
									'div',
									{
										key: hit.sessionId + ':' + hit.seq,
										className: 'dshr-hit',
										'data-sel': active ? '1' : '0',
										'data-dshr-key': hit.sessionId + ':' + hit.seq,
										onClick: function () { setSelected({ sessionId: hit.sessionId, seq: hit.seq }) },
										onDoubleClick: function () { openSession(hit.sessionId) },
										title: TYPE_HINT[hit.type] || hit.type
									},
									h('span', { className: 'dshr-badge', 'data-kind': hit.kind }, KIND_LABEL[hit.kind] || hit.kind),
									h(
										'div',
										{ className: 'dshr-hitbody' },
										h('div', { className: 'dshr-snippet' }, highlight(hit.snippet, terms)),
										h(
											'div',
											{ className: 'dshr-hitline' },
											h('span', null, relTime(hit.time)),
											h('span', null, clock(hit.time)),
											h('span', null, TYPE_HINT[hit.type] || hit.type)
										)
									)
								)
							})
						)
					})
				)
			}

			return h(
				'div',
				{ className: 'dshr-root' },
				h(
					'div',
					{ className: 'dshr-head' },
					h(
						'div',
						{ className: 'dshr-titlebar' },
						h('span', { className: 'dshr-title' }, '全局搜索'),
						h('span', { className: 'dshr-sub' }, '跨项目搜索历史对话里做过的事'),
						h('span', { style: { flex: 1 } }),
						index && index.sessions > 0
							? h('span', { className: 'dshr-sub' }, index.sessions + ' 会话 / ' + index.docs + ' 条')
							: null,
						h('button', { className: 'dshr-ghost', onClick: refresh, title: '重新扫描会话日志' }, '刷新索引')
					),
					h(
						'div',
						{ className: 'dshr-searchrow' },
						h(
							'div',
							{ className: 'dshr-search' },
							h(IconSearch, { size: 15 }),
							h('input', {
								ref: inputRef,
								className: 'dshr-input',
								value: query,
								placeholder: '搜索所有历史对话…  例如：U-Net、发票、那个报错',
								onChange: function (event) { setQuery(event.target.value) },
								onKeyDown: onKeyDown,
								spellCheck: false
							}),
							h('span', { className: 'dshr-kbd' }, 'Ctrl+Shift+F')
						)
					),
					h(
						'div',
						{ className: 'dshr-filters' },
						h(
							'select',
							{
								className: 'dshr-select',
								value: project,
								onChange: function (event) { setProject(event.target.value) },
								title: '按项目过滤'
							},
							h('option', { value: '' }, '全部项目'),
							projects.map(function (entry) {
								return h('option', { key: entry.cwd, value: entry.cwd }, entry.name + ' (' + entry.sessions + ')')
							})
						),
						[
							{ value: 0, label: '全部时间' },
							{ value: 7, label: '近 7 天' },
							{ value: 30, label: '近 30 天' },
							{ value: 365, label: '近一年' }
						].map(function (option) {
							return h(
								'button',
								{
									key: option.value,
									className: 'dshr-ghost',
									'data-on': days === option.value ? '1' : '0',
									onClick: function () { setDays(option.value) }
								},
								option.label
							)
						})
					)
				),
				h('div', { className: 'dshr-body' }, body, query.trim().length > 0 ? h(DetailPane, { detail: detail, loading: detailLoading, terms: terms, openSession: openSession }) : null)
			)
		}

		// ── plugin entry ──────────────────────────────────────────────────────
		function apply(ctx) {
			ctx.effect(function () {
				var style = document.createElement('style')
				style.setAttribute('data-dsh-recall', '')
				style.textContent = CSS
				document.head.appendChild(style)
				return function () {
					if (style.parentNode) style.parentNode.removeChild(style)
				}
			}, 'dsh-recall: styles')

			ctx.effect(function () {
				var onKey = function (event) {
					if (!(event.ctrlKey || event.metaKey) || !event.shiftKey) return
					var key = (event.key || '').toLowerCase()
					if (key !== 'f') return
					event.preventDefault()
					var layout = ctx.get('layout')
					if (layout) layout.selectPanel(PANEL_ID)
				}
				document.addEventListener('keydown', onKey, true)
				return function () {
					document.removeEventListener('keydown', onKey, true)
				}
			}, 'dsh-recall: shortcut')

			ctx.slots.inject('main', function () {
				return ctx.slots.register(
					{
						name: 'main',
						key: PANEL_ID,
						inject: function () {
							return {
								openSession: function (sessionId) {
									var workspace = ctx.get('uiWorkspace')
									if (workspace) workspace.openSession(sessionId)
								}
							}
						}
					},
					RecallPage
				)
			})

			ctx.slots.inject('sidebar.panellist', function () {
				return ctx.slots.register(
					{
						name: 'sidebar.panellist',
						id: PANEL_ID,
						order: 5,
						label: function () { return '全局搜索' }
					},
					RecallIcon
				)
			})

			report('info', 'plugin applied')
		}

		exports.apply = apply
		exports.inject = ['slots']
		exports.__css = CSS
		return module.exports
	}
})
