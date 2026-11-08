/**
 * Weekly report list — Web panel.
 *
 * One sidebar entry and one main panel: capture a line, review a week, carry
 * leftovers forward, then build the report and polish it with the default model.
 */
window.__ModuleLoader__.load({
  id: 'dsh-weekly-log',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useEffect, useRef, useState } = React

    const WEEK_RE = /^(\d{4})-W(\d{2})$/
    const WEEK_MS = 7 * 24 * 60 * 60 * 1000
    const LABEL = { done: '完成', plan: '计划', carried: '顺延', aborted: '中止' }

    function pad2(value) {
      return String(value).padStart(2, '0')
    }

    function isoWeekKey(date = new Date()) {
      const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
      const dayNum = d.getUTCDay() || 7
      d.setUTCDate(d.getUTCDate() + 4 - dayNum)
      const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
      return `${d.getUTCFullYear()}-W${pad2(Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7))}`
    }

    function weekMonday(key) {
      const match = WEEK_RE.exec(String(key ?? ''))
      if (!match) return null
      const year = Number(match[1])
      const week = Number(match[2])
      const jan4 = new Date(year, 0, 4)
      const offset = (jan4.getDay() + 6) % 7
      return new Date(year, 0, 4 - offset + (week - 1) * 7)
    }

    function shiftWeek(key, weeks) {
      const monday = weekMonday(key)
      if (!monday) return key
      return isoWeekKey(new Date(monday.getTime() + weeks * WEEK_MS))
    }

    function weekRangeLabel(key) {
      const monday = weekMonday(key)
      if (!monday) return ''
      const sunday = new Date(monday.getTime() + 6 * 24 * 60 * 60 * 1000)
      return `${monday.getMonth() + 1}/${monday.getDate()} – ${sunday.getMonth() + 1}/${sunday.getDate()}`
    }

    function weekNumber(key) {
      const match = WEEK_RE.exec(String(key ?? ''))
      return match ? Number(match[2]) : 0
    }

    function weekYear(key) {
      const match = WEEK_RE.exec(String(key ?? ''))
      return match ? Number(match[1]) : 0
    }

    function totalWeeksOfYear(year) {
      return weekNumber(isoWeekKey(new Date(year, 11, 28)))
    }

    function weekShort(key) {
      const number = weekNumber(key)
      return number ? `第 ${number} 周` : String(key ?? '')
    }

    function weekFull(key) {
      const number = weekNumber(key)
      if (!number) return String(key ?? '')
      const year = weekYear(key)
      return `${year} 年第 ${number} 周（全年 ${totalWeeksOfYear(year)} 周，${weekRangeLabel(key)}）`
    }

    function rowsFor(entries, week) {
      const rank = { done: 0, plan: 1, carried: 2, aborted: 3 }
      const rows = []
      for (const entry of entries ?? []) {
        const carriedFrom = (entry.history ?? []).some(item => item.action === 'carried' && item.from === week)
        if (entry.week !== week && !carriedFrom) continue
        const viewStatus = entry.week === week ? entry.state : 'carried'
        rows.push({ ...entry, viewStatus, movedTo: entry.week === week ? null : entry.week })
      }
      return rows.sort((a, b) => {
        const delta = rank[a.viewStatus] - rank[b.viewStatus]
        if (delta !== 0) return delta
        if (a.day !== b.day) return a.day < b.day ? -1 : 1
        return a.createdAt < b.createdAt ? -1 : 1
      })
    }

    async function api(payload, signal) {
      const response = await fetch('/weekly/api', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal,
      })
      let data = {}
      try { data = await response.json() } catch { /* empty body */ }
      if (!response.ok || data?.error) throw new Error(data?.error || `请求失败（${response.status}）`)
      return data
    }

    const CSS = `
      .wr-root{height:100%;min-height:0;overflow-y:auto;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}
      .wr-inner{max-width:920px;margin:0 auto;padding:26px 30px 96px;box-sizing:border-box;font-size:14px;line-height:1.62}
      .wr-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:18px}
      .wr-title{margin:0;font-size:20px;font-weight:600;letter-spacing:.2px}
      .wr-sub{margin:4px 0 0;color:var(--dsw-alias-label-secondary);font-size:13px}
      .wr-head-actions{display:flex;gap:8px;flex-shrink:0}
      .wr-card{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:16px;margin-bottom:16px}
      .wr-card.tight{padding:12px 16px}
      .wr-weekbar{display:flex;align-items:center;gap:10px;margin-bottom:14px}
      .wr-weektag{display:inline-flex;align-items:baseline;gap:6px}
      .wr-year{font-size:12px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
      .wr-weeklabel{font-weight:600;font-size:15px;font-variant-numeric:tabular-nums}
      .wr-weekrange{color:var(--dsw-alias-label-secondary);font-size:13px;margin-left:2px}
      .wr-rel{font-size:11px;line-height:1.5;border-radius:999px;padding:1px 8px;color:var(--dsw-alias-label-secondary);border:1px solid var(--dsw-alias-border-l1)}
      .wr-rel.now{color:var(--dsw-alias-brand-primary);border-color:color-mix(in srgb, var(--dsw-alias-brand-primary) 45%, transparent);background:color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, transparent);font-weight:600}
      .wr-card.current{border-color:color-mix(in srgb, var(--dsw-alias-brand-primary) 38%, var(--dsw-alias-border-l1));box-shadow:inset 2px 0 0 var(--dsw-alias-brand-primary)}
      .wr-spacer{flex:1}
      .wr-btn{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:inherit;border-radius:8px;padding:6px 12px;font-size:13px;cursor:pointer;font-family:inherit;line-height:1.4}
      .wr-btn:hover{opacity:.86}
      .wr-btn:disabled{opacity:.45;cursor:default}
      .wr-btn.primary{background:var(--dsw-alias-brand-primary);border-color:transparent;color:#fff}
      .wr-btn.ghost{background:transparent;border-color:transparent;color:var(--dsw-alias-label-secondary);padding:4px 8px}
      .wr-btn.ghost:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2)}
      .wr-btn.danger{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}
      .wr-btn.accent{color:var(--dsw-alias-brand-primary);border-color:color-mix(in srgb, var(--dsw-alias-brand-primary) 45%, transparent);background:color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, transparent);font-weight:600}
      .wr-input{width:100%;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:inherit;border-radius:8px;padding:8px 10px;font-size:14px;font-family:inherit;line-height:1.5;outline:none}
      .wr-input:focus{border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 3px color-mix(in srgb, var(--dsw-alias-brand-primary) 18%, transparent)}
      .wr-input.small{font-size:13px;padding:6px 9px}
      .wr-capture{display:flex;gap:8px;align-items:center}
      .wr-capture .wr-input{flex:1}
      .wr-seg{display:inline-flex;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;overflow:hidden;flex-shrink:0}
      .wr-seg button{border:0;background:transparent;color:var(--dsw-alias-label-secondary);padding:7px 12px;font-size:13px;cursor:pointer;font-family:inherit}
      .wr-seg button.on{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-weight:600}
      .wr-more{display:flex;gap:8px;margin-top:8px}
      .wr-more .wr-input{flex:1}
      .wr-toggle{background:none;border:0;color:var(--dsw-alias-label-secondary);font-size:12px;cursor:pointer;padding:6px 0 0;font-family:inherit}
      .wr-toggle:hover{color:var(--dsw-alias-label-primary)}
      .wr-chips{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px}
      .wr-chip{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:999px;padding:3px 10px}
      .wr-chip b{color:var(--dsw-alias-label-primary);font-weight:600}
      .wr-row{display:flex;align-items:flex-start;gap:12px;padding:10px 0;border-top:1px solid var(--dsw-alias-border-l1)}
      .wr-row:first-of-type{border-top:0}
      .wr-row.dim .wr-text{color:var(--dsw-alias-state-idle-primary);text-decoration:line-through}
      .wr-row-main{flex:1;min-width:0}
      .wr-text{font-size:14px;word-break:break-word}
      .wr-meta{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:4px;font-size:12px;color:var(--dsw-alias-label-secondary)}
      .wr-badge{font-size:11px;border-radius:999px;padding:1px 8px;border:1px solid var(--dsw-alias-border-l2)}
      .wr-badge.done{color:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary)}
      .wr-badge.plan{color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}
      .wr-badge.carried{color:var(--dsw-alias-state-warn-primary);border-color:var(--dsw-alias-state-warn-primary)}
      .wr-badge.aborted{color:var(--dsw-alias-state-idle-primary)}
      .wr-tag{color:var(--dsw-alias-label-secondary);opacity:.9}
      .wr-link{color:var(--dsw-alias-brand-primary);text-decoration:none;word-break:break-all}
      .wr-link:hover{text-decoration:underline}
      .wr-actions{display:flex;gap:2px;flex-shrink:0;flex-wrap:wrap;justify-content:flex-end}
      .wr-empty{color:var(--dsw-alias-label-secondary);font-size:13px;padding:10px 0}
      .wr-error{border:1px solid var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary);border-radius:10px;padding:8px 12px;font-size:13px;margin-bottom:12px;display:flex;gap:10px;align-items:flex-start}
      .wr-error span{flex:1}
      .wr-report-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px}
      .wr-report-title{font-weight:600;font-size:15px}
      .wr-textarea{width:100%;box-sizing:border-box;min-height:180px;resize:vertical;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:inherit;border-radius:10px;padding:12px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;line-height:1.7;outline:none}
      .wr-textarea:focus{border-color:var(--dsw-alias-brand-primary)}
      .wr-report-bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:10px}
      .wr-hint{font-size:12px;color:var(--dsw-alias-label-secondary)}
      .wr-ok{font-size:12px;color:var(--dsw-alias-state-success-primary);word-break:break-all}
      .wr-settings{display:grid;grid-template-columns:110px 1fr;gap:10px 12px;align-items:center}
      .wr-settings label{font-size:13px;color:var(--dsw-alias-label-secondary)}
      .wr-settings .wr-note{grid-column:2;font-size:12px;color:var(--dsw-alias-label-secondary);word-break:break-all}
      .wr-split{height:1px;background:var(--dsw-alias-border-l1);margin:12px 0}
      .wr-update{display:flex;align-items:center;gap:10px;flex-wrap:wrap;border:1px solid color-mix(in srgb, var(--dsw-alias-brand-primary) 42%, transparent);background:color-mix(in srgb, var(--dsw-alias-brand-primary) 8%, transparent);border-radius:10px;padding:8px 12px;margin-bottom:14px;font-size:13px}
      .wr-update .wr-grow{flex:1;min-width:0}
      .wr-version{font-size:12px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
      .wr-inline-edit{display:flex;gap:8px;align-items:center}
      .wr-inline-edit .wr-input{flex:1}
    `

    function Glyph(props) {
      const size = Number(props?.size) || 20
      return h('svg', {
        viewBox: '0 0 64 64', width: size, height: size, 'aria-hidden': true,
        style: { display: 'block', pointerEvents: 'none' },
      },
      h('rect', { x: 6, y: 10, width: 52, height: 48, rx: 9, fill: 'currentColor', opacity: 0.16 }),
      h('rect', { x: 6, y: 10, width: 52, height: 15, rx: 9, fill: 'currentColor', opacity: 0.32 }),
      h('path', { d: 'M17.5 32.5l4.2 4.2 7.6-8.2', fill: 'none', stroke: 'currentColor', strokeWidth: 3.6, strokeLinecap: 'round', strokeLinejoin: 'round' }),
      h('path', { d: 'M17.5 46.5l4.2 4.2 7.6-8.2', fill: 'none', stroke: 'currentColor', strokeWidth: 3.6, strokeLinecap: 'round', strokeLinejoin: 'round', opacity: 0.55 }),
      h('rect', { x: 35, y: 31, width: 15, height: 3.8, rx: 1.9, fill: 'currentColor' }),
      h('rect', { x: 35, y: 45, width: 15, height: 3.8, rx: 1.9, fill: 'currentColor', opacity: 0.55 }))
    }

    function Panel() {
      const [snap, setSnap] = useState(null)
      const [week, setWeek] = useState(null)
      const [draft, setDraft] = useState('')
      const [draftState, setDraftState] = useState('done')
      const [tag, setTag] = useState('')
      const [link, setLink] = useState('')
      const [more, setMore] = useState(false)
      const [error, setError] = useState('')
      const [busy, setBusy] = useState(false)
      const [editing, setEditing] = useState({ id: null, text: '' })
      const [confirmId, setConfirmId] = useState(null)
      const [settingsOpen, setSettingsOpen] = useState(false)
      const [settingsDraft, setSettingsDraft] = useState({ author: '', reportDir: '' })
      const [report, setReport] = useState({ open: false, draft: '', polished: '', busy: false, saved: '', label: '' })
      const [upd, setUpd] = useState({ data: null, armed: false, upgrading: false, banner: true })
      const draftRef = useRef(null)
      const confirmTimer = useRef(null)
      const abortRef = useRef(null)

      const checkUpdateNow = async (force) => {
        try {
          const data = await api({ action: 'checkUpdate', refresh: force === true })
          setUpd(current => ({ ...current, data }))
          return data
        } catch (err) {
          setUpd(current => ({ ...current, data: { ...(current.data ?? {}), error: err.message } }))
          return null
        }
      }

      const startUpgrade = async () => {
        if (!upd.armed) {
          setUpd(current => ({ ...current, armed: true }))
          return
        }
        setUpd(current => ({ ...current, armed: false, upgrading: true }))
        try {
          await api({ action: 'upgrade' })
        } catch (err) {
          setUpd(current => ({ ...current, upgrading: false, data: { ...(current.data ?? {}), error: err.message } }))
        }
      }

      const refresh = async () => {
        try {
          const data = await api({ action: 'state' })
          setSnap(data)
          setWeek(current => current ?? data.currentWeek)
          setSettingsDraft({ author: data.settings?.author ?? '', reportDir: data.settings?.reportDir ?? 'reports' })
          setError('')
        } catch (err) {
          setError(err.message)
        }
      }

      useEffect(() => { refresh() }, [])

      useEffect(() => {
        // One silent check on mount; the banner only appears when a release exists.
        checkUpdateNow(false)
      }, [])

      useEffect(() => {
        if (!upd.upgrading) return undefined
        const startedAt = Date.now()
        const timer = setInterval(async () => {
          const data = await checkUpdateNow(true)
          const phase = data?.lastUpgrade?.phase
          if (phase === 'done' || phase === 'failed') {
            clearInterval(timer)
            setUpd(current => ({ ...current, upgrading: false }))
          } else if (Date.now() - startedAt > 120_000) {
            clearInterval(timer)
            setUpd(current => ({ ...current, upgrading: false }))
          }
        }, 2000)
        return () => clearInterval(timer)
      }, [upd.upgrading])

      const run = async (payload, options = {}) => {
        setBusy(true)
        try {
          const data = await api(payload)
          await refresh()
          if (options.after) options.after(data)
          return data
        } catch (err) {
          setError(err.message)
          return null
        } finally {
          setBusy(false)
        }
      }

      const submit = async () => {
        const text = draft.trim()
        if (!text) return
        const payload = { action: 'add', entry: { text, state: draftState, tag: tag.trim(), link: link.trim() } }
        if (draftState === 'plan' && week) payload.entry.week = week
        const data = await run(payload)
        if (data) {
          setDraft('')
          setTag('')
          setLink('')
          if (draftRef.current) draftRef.current.focus()
        }
      }

      const askDelete = (id) => {
        if (confirmId === id) {
          clearTimeout(confirmTimer.current)
          setConfirmId(null)
          run({ action: 'delete', id })
          return
        }
        setConfirmId(id)
        clearTimeout(confirmTimer.current)
        confirmTimer.current = setTimeout(() => setConfirmId(null), 4000)
      }

      const saveEdit = async () => {
        const text = editing.text.trim()
        if (!text) { setEditing({ id: null, text: '' }); return }
        const data = await run({ action: 'update', id: editing.id, patch: { text } })
        if (data) setEditing({ id: null, text: '' })
      }

      const buildReport = async () => {
        const controller = new AbortController()
        abortRef.current = controller
        setReport(current => ({ ...current, open: true, busy: true, saved: '', polished: '' }))
        try {
          const data = await api({ action: 'report', doneWeek: shiftWeek(week, -1), planWeek: week }, controller.signal)
          setReport(current => ({
            ...current,
            busy: false,
            draft: data.markdown,
            label: `完成 ${data.doneCount} 条 / 计划 ${data.planCount} 条`,
          }))
        } catch (err) {
          if (err?.name === 'AbortError') {
            setReport(current => ({ ...current, busy: false, ...(current.draft ? {} : { open: false }) }))
          } else {
            setReport(current => ({ ...current, busy: false }))
            setError(err.message)
          }
        } finally {
          if (abortRef.current === controller) abortRef.current = null
        }
      }

      const polishReport = async () => {
        const text = report.draft.trim()
        if (!text) return
        const controller = new AbortController()
        abortRef.current = controller
        setReport(current => ({ ...current, busy: true, polished: '' }))
        try {
          const data = await api({ action: 'polish', text }, controller.signal)
          setReport(current => ({ ...current, busy: false, polished: data.text }))
        } catch (err) {
          if (err?.name === 'AbortError') setReport(current => ({ ...current, busy: false }))
          else {
            setReport(current => ({ ...current, busy: false }))
            setError(err.message)
          }
        } finally {
          if (abortRef.current === controller) abortRef.current = null
        }
      }

      const cancelReport = () => {
        const controller = abortRef.current
        if (controller) controller.abort()
      }

      const closeReport = () => {
        if (abortRef.current) abortRef.current.abort()
        abortRef.current = null
        setReport({ open: false, draft: '', polished: '', busy: false, saved: '', label: '' })
      }

      const saveReport = async () => {
        const text = (report.polished || report.draft).trim()
        if (!text) return
        setReport(current => ({ ...current, busy: true }))
        try {
          const data = await api({ action: 'write', text })
          setReport(current => ({ ...current, busy: false, saved: data.path }))
        } catch (err) {
          setReport(current => ({ ...current, busy: false }))
          setError(err.message)
        }
      }

      const copyReport = async () => {
        const text = (report.polished || report.draft).trim()
        if (!text) return
        try {
          await navigator.clipboard.writeText(text)
          setReport(current => ({ ...current, saved: '已复制到剪贴板' }))
        } catch {
          setError('复制失败，请手动选择文本复制')
        }
      }

      const saveSettings = async () => {
        await run({ action: 'settings', settings: settingsDraft })
      }

      const button = (label, onClick, cls, extra) =>
        h('button', { type: 'button', className: `wr-btn${cls ? ` ${cls}` : ''}`, onClick, disabled: busy || (extra && extra.disabled) }, label)

      if (!snap) {
        return h('div', { className: 'wr-root' }, h('style', null, CSS),
          h('div', { className: 'wr-inner' },
            error ? h('div', { className: 'wr-error' }, h('span', null, error)) : h('div', { className: 'wr-empty' }, '正在加载周报清单…')))
      }

      const rows = rowsFor(snap.entries, week)
      const counts = rows.reduce((acc, row) => { acc[row.viewStatus] = (acc[row.viewStatus] ?? 0) + 1; return acc }, {})
      const isCurrent = week === snap.currentWeek
      const relative = isCurrent ? '本周' : week === snap.lastWeek ? '上周' : week === snap.nextWeek ? '下周' : ''

      const updData = upd.data
      const updLast = updData?.lastUpgrade
      const updTarget = updLast?.target ?? updData?.latest
      const updApplied = updLast?.phase === 'done' && updLast?.application === 'applied'
      const updRestart = updLast?.phase === 'done' && updLast?.application === 'restart-required'
      const updFailed = updLast?.phase === 'failed' || (updLast?.phase === 'done' && updLast?.application !== 'applied' && updLast?.application !== 'restart-required')
      const updNew = !!updData?.updateAvailable && !!updData?.canSelfUpgrade

      const updateBanner = () => {
        const ready = updNew || upd.upgrading || updApplied || updRestart || updFailed
        if (!upd.banner || !ready) return null
        const [text, actions] = upd.upgrading
          ? [`正在升级到 ${updTarget ?? '新版本'}…`, [h('span', { key: 'wait', className: 'wr-hint' }, '升级期间不要重启 Harness')]]
          : updApplied
            ? [`已升级到 ${updTarget ?? '新版本'}，刷新页面即可生效`, [button('刷新页面', () => window.location.reload(), 'primary'), button('稍后', () => setUpd(current => ({ ...current, banner: false })), 'ghost')]]
            : updRestart
              ? [`已安装 ${updTarget ?? '新版本'}，需要重启 Harness 后生效`, [button('知道了', () => setUpd(current => ({ ...current, banner: false })), 'ghost')]]
              : updFailed
                ? [`升级失败：${updLast?.error?.diagnostic ?? updLast?.error?.message ?? updLast?.error?.code ?? '未知原因'}`, [button('知道了', () => setUpd(current => ({ ...current, banner: false })), 'ghost')]]
                : [`发现新版本 ${updData.latest}（当前 ${updData.installedVersion}）`, [
                  button(upd.armed ? `确认升级到 ${updData.latest}` : '升级', startUpgrade, upd.armed ? 'accent' : ''),
                  button('稍后', () => setUpd(current => ({ ...current, banner: false })), 'ghost'),
                ]]
        return h('div', { className: 'wr-update' },
          h('span', { className: 'wr-grow' }, text),
          ...actions)
      }

      const rowView = (row) => {
        const status = row.viewStatus
        const meta = []
        meta.push(h('span', { key: 'badge', className: `wr-badge ${status}` },
          status === 'carried' ? `顺延至${weekShort(row.movedTo)}` : LABEL[status]))
        meta.push(h('span', { key: 'day' }, row.day))
        if (row.tag) meta.push(h('span', { key: 'tag', className: 'wr-tag' }, `#${row.tag}`))
        if (row.link) meta.push(h('a', { key: 'link', className: 'wr-link', href: row.link, target: '_blank', rel: 'noreferrer' }, row.link))
        const actions = []
        if (row.viewStatus === 'plan') {
          actions.push(button('完成', () => run({ action: 'setState', id: row.id, state: 'done' }), 'ghost'))
          actions.push(button('顺延', () => run({ action: 'carry', id: row.id }), 'ghost'))
          actions.push(button('中止', () => run({ action: 'setState', id: row.id, state: 'aborted' }), 'ghost'))
        } else if (row.viewStatus === 'done') {
          actions.push(button('转计划', () => run({ action: 'setState', id: row.id, state: 'plan' }), 'ghost'))
          actions.push(button('中止', () => run({ action: 'setState', id: row.id, state: 'aborted' }), 'ghost'))
        } else {
          actions.push(button('恢复为计划', () => run({ action: 'setState', id: row.id, state: 'plan' }), 'ghost'))
        }
        actions.push(button('编辑', () => setEditing({ id: row.id, text: row.text }), 'ghost'))
        actions.push(button(confirmId === row.id ? '确认删除' : '删除', () => askDelete(row.id), confirmId === row.id ? 'ghost danger' : 'ghost'))
        return h('div', { key: row.id, className: `wr-row${status === 'aborted' ? ' dim' : ''}` },
          h('div', { className: 'wr-row-main' },
            editing.id === row.id
              ? h('div', { className: 'wr-inline-edit' },
                h('input', {
                  className: 'wr-input small',
                  value: editing.text,
                  autoFocus: true,
                  onChange: event => setEditing({ id: row.id, text: event.target.value }),
                  onKeyDown: event => {
                    if (event.key === 'Enter') saveEdit()
                    if (event.key === 'Escape') setEditing({ id: null, text: '' })
                  },
                }),
                button('保存', saveEdit, 'primary'),
                button('取消', () => setEditing({ id: null, text: '' }), 'ghost'))
              : h('div', { className: 'wr-text' }, row.text),
            h('div', { className: 'wr-meta' }, meta)),
          h('div', { className: 'wr-actions' }, actions))
      }

      return h('div', { className: 'wr-root' },
        h('style', null, CSS),
        h('div', { className: 'wr-inner' },
          h('div', { className: 'wr-head' },
            h('div', null,
              h('h1', { className: 'wr-title' }, '周报清单'),
              h('p', { className: 'wr-sub' }, '一条一条记下做了什么、要做什么，写周报时按周导出。')),
            h('div', { className: 'wr-head-actions' },
              button(settingsOpen ? '收起设置' : '设置', () => setSettingsOpen(value => !value)))),

          error ? h('div', { className: 'wr-error' },
            h('span', null, error),
            h('button', { type: 'button', className: 'wr-btn ghost', onClick: () => setError('') }, '知道了')) : null,

          updateBanner(),

          settingsOpen ? h('div', { className: 'wr-card' },
            h('div', { className: 'wr-settings' },
              h('label', null, '姓名'),
              h('input', {
                className: 'wr-input', value: settingsDraft.author, placeholder: '写在周报第一行，可留空',
                onChange: event => setSettingsDraft({ ...settingsDraft, author: event.target.value }),
              }),
              h('label', null, '导出目录'),
              h('input', {
                className: 'wr-input', value: settingsDraft.reportDir, placeholder: 'reports（相对当前工作区，也可写绝对路径）',
                onChange: event => setSettingsDraft({ ...settingsDraft, reportDir: event.target.value }),
              }),
              h('div', null),
              h('div', { className: 'wr-note' }, `实际写入：${snap.reportDir}`),
              h('div', null),
              h('div', { className: 'wr-note' }, `数据文件：${snap.storePath}`)),
            h('div', { className: 'wr-split' }),
            h('div', { className: 'wr-report-bar' },
              button('保存设置', saveSettings, 'primary'),
              h('span', { className: 'wr-hint' }, '姓名只需设置一次，之后生成的周报会自动带上。')),
            h('div', { className: 'wr-split' }),
            h('div', { className: 'wr-report-bar' },
              h('span', { className: 'wr-version' }, `版本 ${snap.version ?? '0.0.0'}`),
              button('检查更新', () => { setUpd(current => ({ ...current, banner: true })); checkUpdateNow(true) }, 'ghost'),
              h('span', { className: 'wr-hint' },
                updData?.reason === 'link-install'
                  ? '本地目录链接安装，不支持一键升级；从 npm 安装后这里可用'
                  : updData?.error
                    ? `检查失败：${updData.error}`
                    : updData && !updData.updateAvailable && !updData.latest
                      ? '已是最新版本'
                      : updData?.updateAvailable
                        ? `有新版本 ${updData.latest}`
                        : ''))) : null,

          h('div', { className: 'wr-card tight' },
            h('div', { className: 'wr-capture' },
              h('input', {
                ref: draftRef,
                className: 'wr-input',
                value: draft,
                placeholder: draftState === 'plan' ? '记下要做的事，例如：在 910b 上跑通 qwen image 2.1' : '记下刚做完的事，例如：合并了 warmup 功能',
                onChange: event => setDraft(event.target.value),
                onKeyDown: event => { if (event.key === 'Enter') submit() },
              }),
              h('div', { className: 'wr-seg' },
                h('button', { type: 'button', className: draftState === 'done' ? 'on' : '', onClick: () => setDraftState('done') }, '完成'),
                h('button', { type: 'button', className: draftState === 'plan' ? 'on' : '', onClick: () => setDraftState('plan') }, '计划')),
              button('记录', submit, 'primary', { disabled: !draft.trim() })),
            more
              ? h('div', { className: 'wr-more' },
                h('input', { className: 'wr-input small', value: tag, placeholder: '标签（可选），如 warmup、crossing-studio', onChange: event => setTag(event.target.value) }),
                h('input', { className: 'wr-input small', value: link, placeholder: '链接（可选），PR / issue / 文档', onChange: event => setLink(event.target.value) }))
              : h('button', { type: 'button', className: 'wr-toggle', onClick: () => setMore(true) }, '+ 标签 / 链接'),
            draftState === 'plan' && !isCurrent
              ? h('div', { className: 'wr-hint', style: { marginTop: '6px' } }, `将记入${weekShort(week)}的计划。`)
              : null),

          h('div', { className: `wr-card${isCurrent ? ' current' : ''}` },
            h('div', { className: 'wr-weekbar' },
              h('button', { type: 'button', className: 'wr-btn ghost', onClick: () => setWeek(shiftWeek(week, -1)) }, '‹ 上一周'),
              h('span', { className: 'wr-weektag', title: weekFull(week) },
                h('span', { className: 'wr-year' }, String(weekYear(week))),
                h('span', { className: 'wr-weeklabel' }, weekShort(week))),
              // The tag slot is always present so the range label never shifts; only its text varies.
              h('span', {
                className: `wr-rel${isCurrent ? ' now' : ''}`,
                'aria-hidden': relative ? undefined : true,
                style: relative ? undefined : { visibility: 'hidden' },
              }, relative || '本周'),
              h('span', { className: 'wr-weekrange' }, weekRangeLabel(week)),
              isCurrent ? null : button('回到本周', () => setWeek(snap.currentWeek), 'accent'),
              h('span', { className: 'wr-spacer' }),
              h('button', { type: 'button', className: 'wr-btn ghost', onClick: () => setWeek(shiftWeek(week, 1)) }, '下一周 ›')),
            h('div', { className: 'wr-chips' },
              h('span', { className: 'wr-chip' }, '完成 ', h('b', null, counts.done ?? 0)),
              h('span', { className: 'wr-chip' }, '计划 ', h('b', null, counts.plan ?? 0)),
              h('span', { className: 'wr-chip' }, '顺延出 ', h('b', null, counts.carried ?? 0)),
              h('span', { className: 'wr-chip' }, '中止 ', h('b', null, counts.aborted ?? 0))),
            rows.length ? rows.map(rowView) : h('div', { className: 'wr-empty' }, '这一周还没有记录。')),
          h('div', { className: 'wr-card' },
            h('div', { className: 'wr-report-head' },
              h('span', { className: 'wr-report-title' }, '周报'),
              h('span', { className: 'wr-hint' },
                `当前选中${weekShort(week)}（${weekRangeLabel(week)}）：上周工作取${weekShort(shiftWeek(week, -1))}，本周工作取${weekShort(week)}`)),
            report.open
              ? h('div', null,
                h('textarea', {
                  className: 'wr-textarea',
                  value: report.draft,
                  onChange: event => setReport(current => ({ ...current, draft: event.target.value })),
                  spellCheck: false,
                }),
                h('div', { className: 'wr-report-bar' },
                  report.busy
                    ? h('span', null, button('取消', cancelReport, 'ghost'), h('span', { className: 'wr-hint' }, '处理中…取消后会丢掉这次的生成结果'))
                    : h('span', null,
                      button('AI 检查整理', polishReport, '', { disabled: !report.draft.trim() }),
                      button('复制', copyReport, 'ghost'),
                      button('保存 md', saveReport),
                      button('重新生成', buildReport, 'ghost'),
                      button('关闭', closeReport, 'ghost')),
                  h('span', { className: 'wr-hint' }, report.label)),
                report.polished
                  ? h('div', null,
                    h('div', { className: 'wr-split' }),
                    h('div', { className: 'wr-hint', style: { marginBottom: '6px' } }, '整理结果（未新增事实；请核对后采用。收起会丢弃这次结果，草稿不受影响）'),
                    h('textarea', {
                      className: 'wr-textarea',
                      value: report.polished,
                      onChange: event => setReport(current => ({ ...current, polished: event.target.value })),
                      spellCheck: false,
                    }),
                    h('div', { className: 'wr-report-bar' },
                      button('采用整理结果', () => setReport(current => ({ ...current, draft: current.polished, polished: '' })), 'primary'),
                      button('复制整理结果', async () => {
                        try {
                          await navigator.clipboard.writeText(report.polished.trim())
                          setReport(current => ({ ...current, saved: '已复制到剪贴板' }))
                        } catch { setError('复制失败，请手动选择文本复制') }
                      }, 'ghost'),
                      button('收起', () => setReport(current => ({ ...current, polished: '' })), 'ghost')))
                  : null,
                report.saved ? h('div', { className: 'wr-ok', style: { marginTop: '8px' } }, report.saved) : null)
              : h('div', { className: 'wr-report-bar' },
                button('生成周报', buildReport, 'primary'),
                h('span', { className: 'wr-hint' }, '按「上周完成 + 本周计划」渲染，可再一键整理。')))))
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: 'weekly-report',
          order: 20,
          label: () => '周报',
        }, Glyph))
        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: 'weekly-report',
        }, Panel))
      },
    }
  },
})
