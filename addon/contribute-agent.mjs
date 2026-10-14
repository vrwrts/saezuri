import { spawn } from 'node:child_process'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import { pathToFileURL } from 'node:url'

// The Home Assistant face of saezuri-contribute. Started by run.sh only when the
// github_token option is set, which is the opt-in: nothing here runs otherwise.
//
// Once a day it asks saezuri-contribute what it could offer. When enough species are
// ready it notifies — on a phone with a Contribute action when contribute_notify names
// a Companion app, in Home Assistant otherwise — and opening the pull request then
// takes a tap, or a hassio.addon_stdin call. Waiting for a batch is deliberate: one
// pull request of a dozen birds is far easier for the maintainers than a dozen of one.

const OPTIONS_FILE = '/data/options.json'
const STATE_FILE = '/data/contribute-state.json'
const CORE_API = 'http://supervisor/core/api'
const CORE_WEBSOCKET = 'ws://supervisor/core/websocket'

/** The notification action this agent answers. Any client that fires a
 *  mobile_app_notification_action event with it triggers a contribution. */
export const CONTRIBUTE_ACTION = 'SAEZURI_CONTRIBUTE'
/** Replaces our previous notification rather than stacking up beside it. */
const NOTIFICATION_TAG = 'saezuri-contribute'
const PERSISTENT_ID = 'saezuri_contribute'

const DAY_MS = 24 * 60 * 60 * 1000
/** A dry run is a handful of GitHub reads, so daily is cheap — and means the offer
 *  follows soon after the threshold is crossed. */
const CHECK_INTERVAL_MS = DAY_MS
/** Lets the refresh service settle first, and keeps an app stuck restarting from
 *  checking on every attempt. */
const FIRST_CHECK_DELAY_MS = 10 * 60 * 1000
/** An ignored offer is repeated at most this often, and only once the set has grown. */
const REMIND_AFTER_MS = 7 * DAY_MS
export const DEFAULT_MIN_SPECIES = 10
const RECONNECT_MS = 30 * 1000
/** Species named in a message before it falls back to "and N more". */
const NAMED_IN_MESSAGE = 3

const COMMANDS = ['contribute', 'check']

const log = (msg) => console.log(`saezuri-contribute-agent: ${msg}`)

/** Whether a dry run's result is worth interrupting someone for. `state` is what
 *  was last offered: `{ notifiedAt?, notifiedCount? }`. */
export function shouldNotify(count, state, now, minSpecies) {
  if (count < minSpecies) return false
  if (state.notifiedAt === undefined) return true
  return count > (state.notifiedCount ?? 0) && now - state.notifiedAt >= REMIND_AFTER_MS
}

/** Feeds raw stdin into whole commands. hassio.addon_stdin sends its `input`
 *  JSON-encoded and not necessarily newline-terminated, so a buffered chunk that parses
 *  as JSON counts as complete; a plain `contribute` line (from `docker attach`) works
 *  too. Both `"contribute"` and `{"action": "contribute"}` are accepted. */
export function commandReader(onCommand) {
  let buffer = ''
  const take = (raw) => {
    let value = raw.trim()
    if (!value) return
    try {
      value = JSON.parse(value)
    } catch {
      // A bare word: use it as is.
    }
    if (value && typeof value === 'object') value = value.action
    const command = typeof value === 'string' ? value.trim().toLowerCase() : ''
    if (COMMANDS.includes(command)) onCommand(command)
    else
      log(`ignoring input ${JSON.stringify(raw.trim())} (expected one of ${COMMANDS.join(', ')})`)
  }
  return (chunk) => {
    buffer += chunk
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) take(line)
    try {
      JSON.parse(buffer)
      take(buffer)
      buffer = ''
    } catch {
      // Not complete yet.
    }
  }
}

export function describeSpecies(species) {
  const names = species.map((s) => s.com ?? s.slug)
  if (names.length <= NAMED_IN_MESSAGE) {
    return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0]
  }
  return `${names.slice(0, NAMED_IN_MESSAGE).join(', ')} and ${names.length - NAMED_IN_MESSAGE} more`
}

/** The text of each notification, independent of where it is delivered. */
export const messages = {
  offer: (report) =>
    `${report.species.length} species this app generated ${report.species.length === 1 ? 'is' : 'are'} ` +
    `missing from the shared illustrations: ${describeSpecies(report.species)}.`,
  opened: (report) =>
    `Opened a pull request adding ${describeSpecies(report.species)} to ${report.repo}.`,
  nothing: () =>
    'Nothing new to contribute right now: the shared illustrations, or open pull requests, ' +
    'already have every bird this app generated.',
  failed: (e) =>
    `Contributing failed: ${e instanceof Error ? e.message : String(e)}. See the app log.`,
}

async function loadJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return fallback
  }
}

async function saveState(state) {
  const tmp = `${STATE_FILE}.tmp`
  await writeFile(tmp, JSON.stringify(state))
  await rename(tmp, STATE_FILE)
}

/** Runs the bundled CLI and returns its --json report. The token reaches only this
 *  child, never the environment the rest of the app runs in. */
function runContribute(githubToken, args) {
  return new Promise((resolve, reject) => {
    const child = spawn('saezuri-contribute', [...args, '--json'], {
      env: { ...process.env, GITHUB_TOKEN: githubToken },
      stdio: ['ignore', 'pipe', 'inherit'],
    })
    let out = ''
    child.stdout.on('data', (d) => {
      out += d
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`saezuri-contribute exited ${code}`))
      try {
        resolve(JSON.parse(out))
      } catch (e) {
        reject(e)
      }
    })
  })
}

class Agent {
  busy = false

  constructor({ githubToken, supervisorToken, notifyTarget, minSpecies, addonSlug }) {
    this.githubToken = githubToken
    this.supervisorToken = supervisorToken
    this.notifyTarget = notifyTarget
    this.minSpecies = minSpecies
    this.addonSlug = addonSlug
  }

  async callService(domain, service, data) {
    const res = await fetch(`${CORE_API}/services/${domain}/${service}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.supervisorToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    })
    if (!res.ok) throw new Error(`${domain}.${service} answered HTTP ${res.status}`)
  }

  /** Delivers one message to the phone when one is configured, else to Home
   *  Assistant's own notifications. `offer` adds the way to act on it; `url` is where
   *  tapping the notification goes. */
  async notify(message, { offer = false, url } = {}) {
    try {
      if (this.notifyTarget) {
        const data = { tag: NOTIFICATION_TAG }
        if (offer) data.actions = [{ action: CONTRIBUTE_ACTION, title: 'Contribute' }]
        // `url` is the iOS spelling and `clickAction` the Android one.
        if (url) Object.assign(data, { url, clickAction: url })
        await this.callService('notify', this.notifyTarget, { title: 'Saezuri', message, data })
        return
      }
      const hint = offer
        ? '\n\nTo open a pull request with them, run the `hassio.addon_stdin` action ' +
          `(Developer tools → Actions) with the Saezuri app and \`contribute\` as input:\n\n\`\`\`yaml\naddon: ${this.addonSlug}\ninput: contribute\n\`\`\``
        : ''
      const link = url ? `\n\n[Open the pull request](${url})` : ''
      await this.callService('persistent_notification', 'create', {
        notification_id: PERSISTENT_ID,
        title: 'Saezuri',
        message: `${message}${hint}${link}`,
      })
    } catch (e) {
      log(`could not notify: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  /** `force` is a check someone asked for: it answers even below the threshold or
   *  when nothing changed, so they know it ran. */
  async check(force = false) {
    if (this.busy) return
    this.busy = true
    try {
      const report = await runContribute(this.githubToken, ['--dry-run'])
      const count = report.species.length
      const state = await loadJson(STATE_FILE, {})
      if (force ? count === 0 : !shouldNotify(count, state, Date.now(), this.minSpecies)) {
        log(`${count} species ready (offering from ${this.minSpecies})`)
        if (force) await this.notify(messages.nothing())
        return
      }
      log(`offering ${count} species`)
      await this.notify(messages.offer(report), { offer: true })
      await saveState({ notifiedAt: Date.now(), notifiedCount: count })
    } catch (e) {
      log(e instanceof Error ? e.message : String(e))
      if (force) await this.notify(messages.failed(e))
    } finally {
      this.busy = false
    }
  }

  async contribute() {
    if (this.busy) {
      log('already busy; ignoring the request')
      return
    }
    this.busy = true
    try {
      const report = await runContribute(this.githubToken, ['--yes'])
      if (!report.prUrl) {
        await this.notify(messages.nothing())
        return
      }
      log(`opened ${report.prUrl}`)
      await this.notify(messages.opened(report), { url: report.prUrl })
      // What was offered is now proposed, so the next offer starts from nothing.
      await saveState({})
    } catch (e) {
      log(e instanceof Error ? e.message : String(e))
      await this.notify(messages.failed(e))
    } finally {
      this.busy = false
    }
  }

  /** Answers the phone notification's Contribute action. The action arrives as an
   *  event on Core's websocket, the only place an app can hear it. */
  listenForAction() {
    const ws = new WebSocket(CORE_WEBSOCKET)
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(String(ev.data))
      if (msg.type === 'auth_required') {
        ws.send(JSON.stringify({ type: 'auth', access_token: this.supervisorToken }))
      } else if (msg.type === 'auth_ok') {
        ws.send(
          JSON.stringify({
            id: 1,
            type: 'subscribe_events',
            event_type: 'mobile_app_notification_action',
          }),
        )
      } else if (msg.type === 'auth_invalid') {
        log(`Home Assistant refused the websocket login: ${msg.message}`)
      } else if (msg.type === 'event' && msg.event?.data?.action === CONTRIBUTE_ACTION) {
        void this.contribute()
      }
    })
    ws.addEventListener('close', () => {
      setTimeout(() => this.listenForAction(), RECONNECT_MS)
    })
  }

  start() {
    process.stdin.setEncoding('utf8')
    process.stdin.on(
      'data',
      commandReader((command) => {
        log(`received "${command}"`)
        void (command === 'contribute' ? this.contribute() : this.check(true))
      }),
    )
    if (this.notifyTarget) this.listenForAction()
    setTimeout(() => {
      void this.check()
      setInterval(() => void this.check(), CHECK_INTERVAL_MS)
    }, FIRST_CHECK_DELAY_MS)
  }
}

async function main() {
  const options = await loadJson(OPTIONS_FILE, {})
  const githubToken = String(options.github_token ?? '').trim()
  if (!githubToken) return
  const supervisorToken = process.env.SUPERVISOR_TOKEN
  if (!supervisorToken) {
    log('no SUPERVISOR_TOKEN: cannot reach Home Assistant, so contributing stays off')
    return
  }
  const agent = new Agent({
    githubToken,
    supervisorToken,
    notifyTarget: String(options.contribute_notify ?? '')
      .trim()
      .replace(/^notify\./, ''),
    minSpecies: Number(options.contribute_min_species) || DEFAULT_MIN_SPECIES,
    // The Supervisor names an app's container host after its slug, dashes for
    // underscores; it is what hassio.addon_stdin wants as `addon`.
    addonSlug: hostname().replaceAll('-', '_'),
  })
  log(
    `on: offering from ${agent.minSpecies} species via ` +
      `${agent.notifyTarget ? `notify.${agent.notifyTarget}` : 'Home Assistant notifications'}`,
  )
  agent.start()
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main()
