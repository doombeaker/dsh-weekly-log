/**
 * Weekly report list — Host implementation.
 *
 * Owns the durable store (a profile-level JSON file), the week arithmetic, the
 * shared operations used by both the Web panel and the agent tools, and the
 * same-origin HTTP route that the panel calls.
 */
import { promises as fsp, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE_PATH = fileURLToPath(new URL('../package.json', import.meta.url))
const PLUGIN_NAME = 'dsh-weekly-report'
const pluginVersion = (() => {
  try { return JSON.parse(readFileSync(PACKAGE_PATH, 'utf8')).version ?? '0.0.0' } catch { return '0.0.0' }
})()

const WEEK_RE = /^(\d{4})-W(\d{2})$/
const WEEK_MS = 7 * 24 * 60 * 60 * 1000
const STATES = ['plan', 'done', 'aborted']
const MAX_TEXT = 400

/* ------------------------------------------------------------------ weeks */

function pad2(value) {
  return String(value).padStart(2, '0')
}

/** Local civil date as YYYY-MM-DD. */
export function dayStamp(date = new Date()) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

/** ISO 8601 week key (Monday-first) of a civil date. */
export function isoWeekKey(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
  return `${d.getUTCFullYear()}-W${pad2(week)}`
}

/** Monday 00:00 (local) of an ISO week key. */
export function weekMonday(key) {
  const match = WEEK_RE.exec(String(key ?? ''))
  if (!match) return null
  const year = Number(match[1])
  const week = Number(match[2])
  const jan4 = new Date(year, 0, 4)
  const offset = (jan4.getDay() + 6) % 7
  return new Date(year, 0, 4 - offset + (week - 1) * 7)
}

export function shiftWeek(key, weeks) {
  const monday = weekMonday(key)
  if (!monday) return key
  return isoWeekKey(new Date(monday.getTime() + weeks * WEEK_MS))
}

/** Accepts `current` / `last` / `next` / `YYYY-Www`; undefined means this week. */
export function normalizeWeek(value, fallback = isoWeekKey()) {
  if (value === undefined || value === null || value === '') return fallback
  const raw = String(value).trim()
  const lower = raw.toLowerCase()
  if (lower === 'current' || lower === 'this') return isoWeekKey()
  if (lower === 'last' || lower === 'prev' || lower === 'previous') return shiftWeek(isoWeekKey(), -1)
  if (lower === 'next') return shiftWeek(isoWeekKey(), 1)
  const upper = raw.toUpperCase()
  const match = WEEK_RE.exec(upper)
  if (match) return `${match[1]}-W${match[2]}`
  return fallback
}

/** Human range label, e.g. `11/3 – 11/9`. */
export function weekRangeLabel(key) {
  const monday = weekMonday(key)
  if (!monday) return ''
  const sunday = new Date(monday.getTime() + 6 * 24 * 60 * 60 * 1000)
  const left = `${monday.getMonth() + 1}/${monday.getDate()}`
  const right = `${sunday.getMonth() + 1}/${sunday.getDate()}`
  return `${left} – ${right}`
}

/* ------------------------------------------------------------------ store */

function storePath() {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(home, 'weekly-report', 'data.json')
}

function blankState() {
  return { version: 1, settings: { author: '', reportDir: 'reports' }, entries: [] }
}

function normalizeEntry(raw) {
  if (!raw || typeof raw !== 'object') return null
  const text = typeof raw.text === 'string' ? raw.text.trim() : ''
  if (!text) return null
  const state = STATES.includes(raw.state) ? raw.state : 'done'
  const week = normalizeWeek(raw.week, isoWeekKey())
  return {
    id: String(raw.id || newId()),
    text: text.slice(0, MAX_TEXT),
    state,
    week,
    day: typeof raw.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.day) ? raw.day : dayStamp(),
    tag: typeof raw.tag === 'string' ? raw.tag.trim().slice(0, 60) : '',
    link: typeof raw.link === 'string' ? raw.link.trim().slice(0, 500) : '',
    origin: raw.origin && typeof raw.origin === 'object' ? {
      sessionId: typeof raw.origin.sessionId === 'string' ? raw.origin.sessionId : undefined,
      title: typeof raw.origin.title === 'string' ? raw.origin.title : undefined,
    } : undefined,
    history: Array.isArray(raw.history) ? raw.history.filter(item => item && typeof item === 'object') : [],
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString(),
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString(),
  }
}

function newId() {
  return `e${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

function createStore(ctx) {
  let state = blankState()
  let loaded = false
  let chain = Promise.resolve()

  const load = async () => {
    if (loaded) return state
    loaded = true
    try {
      const raw = JSON.parse(await fsp.readFile(storePath(), 'utf8'))
      const settings = { ...blankState().settings, ...(raw && typeof raw.settings === 'object' ? raw.settings : {}) }
      const entries = Array.isArray(raw?.entries) ? raw.entries.map(normalizeEntry).filter(Boolean) : []
      state = { version: 1, settings, entries }
    } catch (error) {
      if (error?.code !== 'ENOENT') ctx.logger?.warn?.(`weekly-report: could not read ${storePath()}: ${error.message}`)
      state = blankState()
    }
    return state
  }

  const persist = () => {
    chain = chain.then(async () => {
      const file = storePath()
      await fsp.mkdir(dirname(file), { recursive: true })
      const tmp = `${file}.${process.pid}.tmp`
      await fsp.writeFile(tmp, JSON.stringify(state, null, 2), 'utf8')
      await fsp.rename(tmp, file)
    }).catch(error => ctx.logger?.warn?.(`weekly-report: save failed: ${error.message}`))
    return chain
  }

  return {
    get path() { return storePath() },
    load,
    get state() { return state },
    persist,
  }
}

/* ------------------------------------------------------------------ logic */

function compareEntries(a, b) {
  if (a.day !== b.day) return a.day < b.day ? -1 : 1
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0
}

function cleanText(value) {
  const text = String(value ?? '').trim().replace(/^[-*•]\s*/, '')
  if (!text) throw new Error('记录内容不能为空')
  if (text.length > MAX_TEXT) throw new Error(`一条记录最多 ${MAX_TEXT} 个字符`)
  return text
}

function createOps(store, ctx) {
  const entries = () => store.state.entries

  const find = (id) => {
    const entry = entries().find(item => item.id === String(id))
    if (!entry) throw new Error(`没有找到条目 ${id}`)
    return entry
  }

  const touch = (entry, patch) => {
    Object.assign(entry, patch, { updatedAt: new Date().toISOString() })
    return entry
  }

  const add = async (input = {}) => {
    const state = STATES.includes(input.state) ? input.state : 'done'
    const week = normalizeWeek(input.week, isoWeekKey())
    const entry = normalizeEntry({
      id: newId(),
      text: cleanText(input.text),
      state,
      week,
      day: dayStamp(),
      tag: input.tag,
      link: input.link,
      origin: input.origin,
      history: [{ at: new Date().toISOString(), action: 'created', week, state }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    entries().push(entry)
    await store.persist()
    return entry
  }

  const update = async (id, patch = {}) => {
    const entry = find(id)
    const next = {}
    if (patch.text !== undefined) next.text = cleanText(patch.text)
    if (patch.tag !== undefined) next.tag = String(patch.tag ?? '').trim().slice(0, 60)
    if (patch.link !== undefined) next.link = String(patch.link ?? '').trim().slice(0, 500)
    if (patch.week !== undefined) {
      const week = normalizeWeek(patch.week, entry.week)
      if (week !== entry.week) {
        entry.history.push({ at: new Date().toISOString(), action: 'moved', from: entry.week, to: week })
        next.week = week
      }
    }
    touch(entry, next)
    await store.persist()
    return entry
  }

  const setState = async (id, nextState) => {
    if (!STATES.includes(nextState)) throw new Error(`未知状态 ${nextState}`)
    const entry = find(id)
    if (entry.state === nextState) return entry
    const at = new Date().toISOString()
    if (nextState === 'done') {
      entry.history.push({ at, action: 'done', from: entry.state, week: isoWeekKey(), plannedWeek: entry.week })
      touch(entry, { state: 'done', week: isoWeekKey(), day: dayStamp() })
    } else if (nextState === 'aborted') {
      entry.history.push({ at, action: 'aborted', from: entry.state, week: entry.week })
      touch(entry, { state: 'aborted', day: dayStamp() })
    } else {
      entry.history.push({ at, action: 'reopened', from: entry.state, week: isoWeekKey() })
      touch(entry, { state: 'plan', week: isoWeekKey(), day: dayStamp() })
    }
    await store.persist()
    return entry
  }

  /** Carry a plan forward: last week's leftovers land in this week, this week's in next. */
  const carry = async (id, target) => {
    const entry = find(id)
    if (entry.state !== 'plan') throw new Error('只有「计划」条目可以顺延')
    const week = normalizeWeek(target, entry.week < isoWeekKey() ? isoWeekKey() : shiftWeek(entry.week, 1))
    if (week === entry.week) return entry
    entry.history.push({ at: new Date().toISOString(), action: 'carried', from: entry.week, to: week })
    touch(entry, { week })
    await store.persist()
    return entry
  }

  const remove = async (id) => {
    const entry = find(id)
    const index = entries().indexOf(entry)
    if (index >= 0) entries().splice(index, 1)
    await store.persist()
    return entry
  }

  /** Rows a given week should show, including plans carried out of it. */
  const weekRows = (week) => {
    const rows = []
    for (const entry of entries()) {
      const carriedFrom = (entry.history ?? []).some(item => item.action === 'carried' && item.from === week)
      if (entry.week !== week && !carriedFrom) continue
      const view = entry.week === week ? entry.state : 'carried'
      rows.push({
        ...entry,
        viewStatus: view,
        movedTo: entry.week === week ? null : entry.week,
      })
    }
    const rank = { done: 0, plan: 1, carried: 2, aborted: 3 }
    return rows.sort((a, b) => (rank[a.viewStatus] - rank[b.viewStatus]) || compareEntries(a, b))
  }

  const counts = (week) => {
    const rows = weekRows(week)
    return {
      done: rows.filter(row => row.viewStatus === 'done').length,
      plan: rows.filter(row => row.viewStatus === 'plan').length,
      carried: rows.filter(row => row.viewStatus === 'carried').length,
      aborted: rows.filter(row => row.viewStatus === 'aborted').length,
      total: rows.length,
    }
  }

  const buildReport = ({ doneWeek, planWeek } = {}) => {
    const done = normalizeWeek(doneWeek, shiftWeek(isoWeekKey(), -1))
    const plan = normalizeWeek(planWeek, isoWeekKey())
    const lineOf = (entry) => {
      const link = entry.link && !entry.text.includes(entry.link) ? `：${entry.link}` : ''
      return `${entry.text}${link}`
    }
    const doneRows = entries()
      .filter(entry => entry.state === 'done' && entry.week === done)
      .sort(compareEntries)
      .map(lineOf)
    const planRows = entries()
      .filter(entry => entry.state === 'plan' && entry.week === plan)
      .sort(compareEntries)
      .map(lineOf)
    const author = String(store.state.settings.author ?? '').trim()
    const lines = []
    if (author) lines.push(`姓名：${author}`)
    lines.push('上周工作：')
    for (const line of doneRows) lines.push(`- ${line}`)
    lines.push('本周工作：')
    for (const line of planRows) lines.push(`- ${line}`)
    return { markdown: lines.join('\n'), doneWeek: done, planWeek: plan, doneCount: doneRows.length, planCount: planRows.length }
  }

  const saveSettings = async (patch = {}) => {
    const settings = store.state.settings
    if (patch.author !== undefined) settings.author = String(patch.author ?? '').trim().slice(0, 60)
    if (patch.reportDir !== undefined) settings.reportDir = String(patch.reportDir ?? '').trim().slice(0, 300) || 'reports'
    await store.persist()
    return settings
  }

  return { add, update, setState, carry, remove, weekRows, counts, buildReport, saveSettings, find, entries }
}

/* ------------------------------------------------------------------ paths */

function baseDirectory(ctx) {
  try {
    const list = ctx.get?.('workspaceRegistry')?.list?.()
    if (Array.isArray(list) && list.length) {
      const found = list[list.length - 1]
      if (typeof found?.path === 'string' && found.path) return found.path
    }
  } catch { /* registry unavailable */ }
  try {
    const fallback = ctx.get?.('workingDirectory')?.defaultDirectory
    if (typeof fallback === 'string' && fallback) return fallback
  } catch { /* service unavailable */ }
  return process.cwd()
}

function resolveReportDir(ctx, settings) {
  const configured = String(settings?.reportDir ?? 'reports').trim() || 'reports'
  return isAbsolute(configured) ? configured : resolve(baseDirectory(ctx), configured)
}

/* --------------------------------------------------------------- polish */

const POLISH_SYSTEM = [
  '你是周报编辑。用户会给出周报草稿（可能中英混杂、带链接、有错别字）。请只做措辞层面的整理。',
  '规则：',
  '1. 每条一行；以动词开头（完成、合并、适配、调研、修复、验证、评审、推进、发布…）。',
  '2. 每条尽量不超过 40 个字（链接本身不计入）。',
  '3. 专有名词、人名、项目名、仓库名、版本号、数字、链接保持原样，不要翻译或改写。',
  '4. 不新增事实、不推测、不评价；不同工作内容不要合并；只有明显重复的同一件事才合并。',
  '5. 保留原有结构：姓名行（若有）、「上周工作：」「本周工作：」两个标题及其顺序；标题和姓名行原样保留。',
  '6. 统一使用全角冒号与顿号，去掉多余的「了」「一下」「进行」等赘余词，修正错别字与标点。',
  '只输出整理后的周报文本：不要解释，不要 Markdown 代码块，不要额外空行。',
].join('\n')

async function polish(ctx, text, callerSignal) {
  const draft = String(text ?? '').trim()
  if (!draft) throw new Error('没有可以整理的草稿')
  const llm = ctx.get?.('llm')
  if (!llm?.stream) throw new Error('当前环境没有可用的模型服务（ctx.llm）')
  const selection = ctx.get?.('agentDefaultModel')?.currentSelection?.()
  if (!selection?.provider || !selection?.model) {
    throw new Error('还没有配置默认模型，请先在 Harness 设置里选择模型后再整理')
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 90_000)
  const signal = callerSignal ? AbortSignal.any([controller.signal, callerSignal]) : controller.signal
  try {
    const stream = llm.stream({
      provider: selection.provider,
      model: selection.model,
      system: POLISH_SYSTEM,
      messages: [{ role: 'user', content: [{ type: 'text', text: draft }] }],
      temperature: 0.2,
      maxTokens: 1500,
      signal,
    })
    const parts = []
    let finish
    for await (const chunk of stream) {
      if (chunk.type === 'text-delta') parts.push(chunk.text)
      else if (chunk.type === 'finish') finish = chunk.reason
    }
    if (finish && finish.kind === 'error') throw new Error(finish.failure?.message || '模型调用失败')
    if (finish && finish.kind === 'aborted') throw new Error('整理被取消或超时')
    if (finish && finish.kind === 'max-tokens') throw new Error('草稿太长，模型输出被截断，请缩短后重试')
    const output = parts.join('').trim()
    if (!output) throw new Error('模型没有返回内容')
    return { text: output.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim(), model: `${selection.provider}/${selection.model}` }
  } finally {
    clearTimeout(timer)
  }
}

async function writeReport(ctx, store, text) {
  const dir = resolveReportDir(ctx, store.state.settings)
  const week = normalizeWeek(isoWeekKey())
  const file = join(dir, `weekly-${week}.md`)
  await fsp.mkdir(dir, { recursive: true })
  await fsp.writeFile(file, `${String(text ?? '').trimEnd()}\n`, 'utf8')
  return { path: file, dir }
}

/* --------------------------------------------------------------- update */

const UPDATE_CACHE_MS = 10 * 60 * 1000
const updateCache = { at: 0, info: null }

function compareVersions(left, right) {
  const parse = (value) => {
    const [core, pre] = String(value ?? '').split('-')
    return { nums: core.split('.').map(part => Number.parseInt(part, 10) || 0), pre: pre ?? '' }
  }
  const a = parse(left)
  const b = parse(right)
  for (let i = 0; i < Math.max(a.nums.length, b.nums.length); i += 1) {
    const delta = (a.nums[i] ?? 0) - (b.nums[i] ?? 0)
    if (delta !== 0) return delta
  }
  if (a.pre === b.pre) return 0
  if (!a.pre) return 1
  if (!b.pre) return -1
  return a.pre.localeCompare(b.pre)
}

function upgradeStatePath() {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(home, 'weekly-report', 'upgrade-state.json')
}

async function writeUpgradeState(state) {
  const file = upgradeStatePath()
  try {
    await fsp.mkdir(dirname(file), { recursive: true })
    await fsp.writeFile(file, JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2), 'utf8')
  } catch { /* diagnostics are best effort */ }
}

async function readUpgradeState() {
  try {
    return JSON.parse(await fsp.readFile(upgradeStatePath(), 'utf8'))
  } catch {
    return null
  }
}

/**
 * Compare the installed version with the newest compatible release.
 * Returns why a self-upgrade is not possible instead of guessing: a `link:`
 * install lives outside the registry and `pluginManager.updateBundle` refuses it.
 */
async function checkUpdate(ctx, { refresh = false } = {}) {
  if (!refresh && updateCache.info && Date.now() - updateCache.at < UPDATE_CACHE_MS) return updateCache.info
  const manager = ctx.get?.('pluginManager')
  const result = {
    current: pluginVersion,
    installedVersion: pluginVersion,
    latest: null,
    updateAvailable: false,
    canSelfUpgrade: false,
    installSource: null,
    reason: null,
    error: null,
    checkedAt: new Date().toISOString(),
  }
  try {
    const bundles = await manager?.listBundles?.()
    const self = Array.isArray(bundles) ? bundles.find(bundle => bundle?.name === PLUGIN_NAME) : undefined
    result.installSource = self?.source ?? null
    result.installedVersion = self?.version ?? pluginVersion
    const linkInstall = String(result.installSource ?? '').startsWith('link:')
    if (linkInstall) {
      result.reason = 'link-install'
    } else if (typeof manager?.listVersions !== 'function') {
      result.reason = 'no-manager'
    } else {
      const list = await manager.listVersions(PLUGIN_NAME)
      if (list?.status === 'listed') {
        const candidate = (list.versions ?? []).find(version => version.bundle !== false && !version.incompatible && !version.deprecated)
        result.latest = candidate?.version ?? null
        result.updateAvailable = !!result.latest && compareVersions(result.latest, result.installedVersion) > 0
      } else {
        result.reason = list?.reason ?? list?.problem ?? 'unknown'
      }
    }
    result.canSelfUpgrade = result.updateAvailable
      && typeof manager?.updateBundle === 'function'
      && String(result.installSource ?? '').startsWith('link:') === false
  } catch (error) {
    result.error = error?.message ?? String(error)
  }
  updateCache.at = Date.now()
  updateCache.info = result
  return result
}

/** Start a registry upgrade in the background; the panel polls `checkUpdate`. */
async function startUpgrade(ctx) {
  const manager = ctx.get?.('pluginManager')
  if (typeof manager?.updateBundle !== 'function') throw new Error('当前环境不支持自升级：pluginManager 未提供 updateBundle')
  const info = await checkUpdate(ctx, { refresh: true })
  if (info.reason === 'link-install') throw new Error('当前是本地目录链接安装，不能用一键升级；请先从 npm 安装这个包')
  if (info.error) throw new Error(info.error)
  if (!info.latest) throw new Error('没有发现可用的新版本')
  const requestId = `weekly-report-upgrade-${Date.now()}`
  await writeUpgradeState({ requestId, from: info.installedVersion, target: info.latest, phase: 'starting' })
  setTimeout(async () => {
    try {
      // A mirror can lag right after a release: retry, then fall back to the public registry.
      const attempts = [
        { wait: 0, options: { requestId } },
        { wait: 15_000, options: { requestId } },
        { wait: 20_000, options: { requestId, registry: 'https://registry.npmjs.org/' } },
      ]
      let update = null
      for (const [index, attempt] of attempts.entries()) {
        if (attempt.wait) await new Promise(resolveTimer => setTimeout(resolveTimer, attempt.wait))
        update = await manager.updateBundle(PLUGIN_NAME, info.latest, attempt.options)
        const change = update?.result ?? update
        if (change?.application !== 'failed' || update?.step !== 'check') break
        ctx.logger?.warn?.(`weekly-report: upgrade check failed (attempt ${index + 1}); retrying`)
      }
      const change = update?.result ?? update
      await writeUpgradeState({
        requestId,
        from: info.installedVersion,
        target: info.latest,
        phase: 'done',
        application: change?.application ?? null,
        restartReason: change?.restartReason ?? null,
        step: update?.step ?? null,
        restored: update?.restore?.application ?? null,
        error: change?.error ? { code: change.error.code, diagnostic: change.error.diagnostic } : null,
      })
    } catch (error) {
      await writeUpgradeState({
        requestId,
        from: info.installedVersion,
        target: info.latest,
        phase: 'failed',
        error: { message: error?.message ?? String(error) },
      })
    }
  }, 400)
  return { started: true, requestId, target: info.latest, from: info.installedVersion }
}

/* ---------------------------------------------------------------- routes */

function readBody(req) {
  return new Promise((resolvePromise, reject) => {
    const chunks = []
    let size = 0
    req.on('data', chunk => {
      size += chunk.length
      if (size > 2 * 1024 * 1024) {
        reject(new Error('request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolvePromise(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

async function dispatch(ctx, store, ops, request, signal) {
  const action = String(request?.action ?? '')
  switch (action) {
    case 'state': {
      const current = isoWeekKey()
      return {
        settings: store.state.settings,
        currentWeek: current,
        lastWeek: shiftWeek(current, -1),
        nextWeek: shiftWeek(current, 1),
        entries: store.state.entries.slice().sort(compareEntries),
        reportDir: resolveReportDir(ctx, store.state.settings),
        storePath: store.path,
        version: pluginVersion,
      }
    }
    case 'week':
      return { rows: ops.weekRows(normalizeWeek(request.week)), counts: ops.counts(normalizeWeek(request.week)) }
    case 'add':
      return { entry: await ops.add(request.entry ?? request) }
    case 'update':
      return { entry: await ops.update(request.id, request.patch ?? request) }
    case 'setState':
      return { entry: await ops.setState(request.id, request.state) }
    case 'carry':
      return { entry: await ops.carry(request.id, request.week) }
    case 'delete':
      return { entry: await ops.remove(request.id) }
    case 'report':
      return ops.buildReport({ doneWeek: request.doneWeek, planWeek: request.planWeek })
    case 'write':
      return writeReport(ctx, store, request.text)
    case 'polish':
      return polish(ctx, request.text, signal)
    case 'settings':
      return { settings: await ops.saveSettings(request.settings ?? request) }
    case 'checkUpdate':
      return { ...(await checkUpdate(ctx, { refresh: request.refresh === true })), lastUpgrade: await readUpgradeState() }
    case 'upgrade':
      return startUpgrade(ctx)
    default:
      throw new Error(`未知操作 "${action}"`)
  }
}

/* ----------------------------------------------------------------- tools */

function rowsToText(week, rows, ctx) {
  if (!rows.length) return `${week}（${weekRangeLabel(week)}）没有记录。`
  const label = { done: '完成', plan: '计划', carried: '顺延', aborted: '中止' }
  const lines = rows.map(row => {
    const tag = row.tag ? ` [${row.tag}]` : ''
    const move = row.movedTo ? ` → ${row.movedTo}` : ''
    return `- ${label[row.viewStatus] ?? row.viewStatus}${move} ${row.text}${tag}${row.link ? ` ${row.link}` : ''}（${row.id}）`
  })
  return `${week}（${weekRangeLabel(week)}）：\n${lines.join('\n')}`
}

const textOutput = {
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['text'],
    properties: { text: { type: 'string' } },
  },
  render: (_args, value) => [{ type: 'text', text: String(value?.text ?? '') }],
}

function weeklyLogTool(ctx, store, ops) {
  return {
    name: 'weekly_log',
    description: '维护用户的周报清单：记录、查看、修改条目。周报条目是用户自己记的工作流水，和 todo_write 的计划清单无关。用户说「记一下」「帮我记上」「这周都干了什么」时使用。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['action'],
      properties: {
        action: {
          type: 'string',
          enum: ['add', 'list', 'update', 'set_state', 'carry', 'delete'],
          description: 'add 记一条；list 按周查看；update 改文字/标签/链接；set_state 改状态；carry 顺延；delete 删除。',
        },
        text: { type: 'string', description: '条目正文，一句话说清做了什么或要做什么。add 必填；update 传入即覆盖正文。' },
        id: { type: 'string', description: '条目 id。update / set_state / carry / delete 必填。' },
        state: { type: 'string', enum: ['done', 'plan', 'aborted'], description: 'add 的初始状态，默认 done；set_state 的目标状态。' },
        week: {
          type: 'string',
          description: '归属周：current（本周，默认）、last、next，或 YYYY-Www。add 时用于把计划放到下周；carry 时用于指定顺延到哪一周。',
        },
        tag: { type: 'string', description: '可选的项目或仓库名，用于区分工作线，例如 warmup、crossing-studio。' },
        link: { type: 'string', description: '可选的 PR / issue / 文档链接。' },
      },
    },
    output: textOutput,
    async execute(args) {
      const action = args?.action
      if (action === 'add') {
        const entry = await ops.add({ text: args.text, state: args.state, week: args.week, tag: args.tag, link: args.link })
        return { text: `已记录到 ${entry.week}（${entry.state === 'plan' ? '计划' : entry.state === 'aborted' ? '中止' : '完成'}）：${entry.text}（${entry.id}）` }
      }
      if (action === 'list') {
        const week = normalizeWeek(args.week, isoWeekKey())
        return { text: rowsToText(week, ops.weekRows(week), ctx) }
      }
      if (action === 'update') {
        const entry = await ops.update(args.id, { text: args.text, tag: args.tag, link: args.link, week: args.week })
        return { text: `已更新：${entry.text}（${entry.id}）` }
      }
      if (action === 'set_state') {
        const entry = await ops.setState(args.id, args.state)
        return { text: `已标记为${entry.state === 'plan' ? '计划' : entry.state === 'aborted' ? '中止' : '完成'}：${entry.text}（${entry.id}）` }
      }
      if (action === 'carry') {
        const entry = await ops.carry(args.id, args.week)
        return { text: `已顺延到 ${entry.week}：${entry.text}（${entry.id}）` }
      }
      if (action === 'delete') {
        const entry = await ops.remove(args.id)
        return { text: `已删除：${entry.text}（${entry.id}）` }
      }
      throw new Error(`未知 action "${action}"`)
    },
  }
}

function weeklyReportTool(ctx, store, ops) {
  return {
    name: 'weekly_report',
    description: '把周报清单里的条目渲染成周报正文，或写成 md 文件。上周工作取该周完成的条目，本周工作取当前仍为计划的条目。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['action'],
      properties: {
        action: { type: 'string', enum: ['build', 'write'], description: 'build 只返回正文；write 同时写入导出目录的 md 文件。' },
        doneWeek: { type: 'string', description: '「上周工作」取自哪一周，默认上一周。可传 last / current / next 或 YYYY-Www。' },
        planWeek: { type: 'string', description: '「本周工作」取自哪一周，默认本周。' },
      },
    },
    output: textOutput,
    async execute(args) {
      const report = ops.buildReport({ doneWeek: args.doneWeek, planWeek: args.planWeek })
      if (args.action === 'write') {
        const written = await writeReport(ctx, store, report.markdown)
        return { text: `${report.markdown}\n\n已保存到 ${written.path}` }
      }
      return { text: report.markdown }
    },
  }
}

/* ------------------------------------------------------------------ apply */

export async function apply(ctx, rawConfig) {
  const store = createStore(ctx)
  await store.load()
  const ops = createOps(store, ctx)

  const disposers = []
  const register = (dispose) => {
    if (typeof dispose === 'function') disposers.push(dispose)
  }

  register(ctx.tools.register(weeklyLogTool(ctx, store, ops)))
  register(ctx.tools.register(weeklyReportTool(ctx, store, ops)))

  const handler = async (req, res) => {
    const controller = new AbortController()
    res.on('close', () => { if (!res.writableEnded) controller.abort() })
    try {
      const body = await readBody(req)
      const request = body ? JSON.parse(body) : {}
      sendJson(res, 200, await dispatch(ctx, store, ops, request, controller.signal))
    } catch (error) {
      try {
        sendJson(res, 400, { error: error?.message || String(error) })
      } catch { /* response already started */ }
    }
  }

  let attached = false
  const attach = () => {
    if (attached) return true
    const web = ctx.get?.('webServer')
    if (!web?.register) return false
    try {
      register(web.register({ kind: 'prefix', path: '/weekly/api', handler }))
      attached = true
      return true
    } catch (error) {
      ctx.logger?.warn?.(`weekly-report: panel routes unavailable: ${error.message}`)
      return false
    }
  }
  if (!attach()) {
    // The web server service may mount after this plugin at cold start.
    const timer = setInterval(() => { if (attach()) clearInterval(timer) }, 300)
    register(() => clearInterval(timer))
  }

  return async () => {
    for (const dispose of disposers.reverse()) {
      try { await dispose() } catch { /* already disposed */ }
    }
  }
}
