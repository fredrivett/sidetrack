import type { PluginAPI, ThreadID, WebhookEvent, WebhookHandlerContext } from '@ampcode/plugin'
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { readAgentRequest } from '../../src/lib/agentRequest'

export const description =
	"Starts an Amp thread in an orb when Amp is assigned to a Sidetrack item, and tells it to stop when it's unassigned. Active only in the dispatcher thread named by SIDETRACK_DISPATCHER_THREAD."

// Setup, once (see the PR for SDT-55):
//
// 1. Start an orb thread in this project to be the dispatcher, and set the
//    project environment variable SIDETRACK_DISPATCHER_THREAD to its ID
//    (T-…). Every other thread loads this plugin and does nothing.
// 2. In Sidetrack, Settings → API keys, on the key Amp's Sidetrack MCP server
//    uses (started threads call start_work with it, which links them to the
//    item), click "Start work when assigned". Store the signing secret it
//    shows as the project secret SIDETRACK_AGENT_SECRET.
// 3. In the dispatcher thread, reload the plugin (or restart the orb's
//    processes, so it sees the new variables). It writes the webhook URL to
//    the file it logs, readable only by you: open it from the Terminal tab and
//    paste it into Sidetrack. The URL is a credential: keep it out of chats.
//
// Then a list's admin assigns Amp to an item, on a list with a repository.
// Sidetrack posts a signed start request; this starts an orb thread on the
// list's repository, asked to work the item. Unassigning posts a stop
// request; this tells that thread, and only that one, to stop.

const SECRET_ENV = 'SIDETRACK_AGENT_SECRET'
const DISPATCHER_ENV = 'SIDETRACK_DISPATCHER_THREAD'

/** The first message of a thread started on an item. */
function startMessage(ref: string): string {
	return (
		`Work on Sidetrack item ${ref}. Read it with get_item, then call start_work with this thread's URL; ` +
		`Sidetrack already shows you on it, and start_work links this thread there. ` +
		`Do the work following the repository's AGENTS.md, as far as that guidance takes you, ` +
		`including opening and owning the pull request. If you're unsure about anything, such as what the ` +
		`item asks, a product decision, or whether the change is safe, don't turn on auto-merge: leave the ` +
		`pull request open and ask on the item with add_comment. When the pull request merges and it's ` +
		`clear the change fixes what the item asks, mark the item done with complete_item; if it seems ` +
		`there's more to do, ask on the item with add_comment instead of completing it.`
	)
}

/** The steering message for a thread whose item it was unassigned from. */
function stopMessage(ref: string): string {
	return (
		`You were unassigned from ${ref} in Sidetrack. Stop now: push nothing more, and turn off ` +
		`auto-merge if you turned it on. Leave the branch and any pull request as they are, and end your turn.`
	)
}

/**
 * What happened for each Sidetrack session: which thread its start created,
 * and whether that thread has been prompted and stopped. It makes a
 * redelivered start a no-op and lets a stop reach only the thread its start
 * created. A stop that arrives before its start leaves a stopped entry, so the
 * start never runs.
 *
 * Each side effect is recorded just before it starts and never retried once
 * started: a call that fails or times out may still have happened (a thread created, a
 * message sent, with the answer lost), so it's logged and left. An orb
 * started twice, or a thread told twice to start, is worse than one that
 * didn't happen, which unassigning and assigning again in Sidetrack (a new
 * session) fixes.
 */
type Sessions = Record<
	string,
	{ ref: string; thread: ThreadID | null; prompted: boolean; stopped: boolean }
>

export default async function sidetrackDispatch(amp: PluginAPI) {
	const dispatcher = process.env[DISPATCHER_ENV]
	if (!dispatcher || process.env.AMP_THREAD_ID !== dispatcher) return
	const root = amp.system.workspaceRoot
	if (!root) return

	// Kept in orb-backup, which survives the orb being deleted. No secrets.
	const statePath = join(
		amp.helpers.filePathFromURI(root),
		'.amp/in/orb-backup/sidetrack-dispatch.json',
	)
	const load = (): Sessions => {
		try {
			return JSON.parse(readFileSync(statePath, 'utf8')) as Sessions
		} catch (error) {
			// Only a missing file means no sessions yet. Anything else fails the
			// delivery, so Amp retries it rather than it acting on forgotten state.
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
			throw error
		}
	}
	const save = (sessions: Sessions) => {
		mkdirSync(dirname(statePath), { recursive: true })
		writeFileSync(`${statePath}.tmp`, JSON.stringify(sessions, null, '\t'))
		renameSync(`${statePath}.tmp`, statePath)
	}

	const handle = async (event: WebhookEvent, ctx: WebhookHandlerContext) => {
		const secret = process.env[SECRET_ENV]
		if (!secret) {
			amp.logger.log(`Ignored a request: ${SECRET_ENV} isn't set.`)
			return
		}
		const request = readAgentRequest(event.body, event.headers, secret, new Date(event.receivedAt))
		// Refused requests aren't retried: the same bytes would be refused again.
		if ('refused' in request) {
			amp.logger.log(`Refused request ${event.id}: ${request.refused}.`)
			return
		}
		// A delivery that waited past its deadline in the queue hasn't done
		// anything yet, so it fails for Amp to deliver again.
		ctx.signal.throwIfAborted()
		const sessions = load()
		const known = sessions[request.sessionId]

		if (request.type === 'stop') {
			if (!known) {
				// Stopped before it started: keep it from starting.
				sessions[request.sessionId] = { ref: request.ref, thread: null, prompted: false, stopped: true }
				save(sessions)
				return
			}
			if (known.stopped) return
			known.stopped = true
			save(sessions)
			if (!known.thread || !known.prompted) return
			const thread = known.thread
			await once(`stop ${thread} on ${request.ref}`, ctx.signal, () =>
				amp.threads
					.get(thread)
					.appendUserMessage({ type: 'user-message', content: stopMessage(request.ref) }, { steer: true }),
			)
			return
		}

		if (known) {
			// Its thread was made, then the plugin stopped before the prompt.
			if (known.thread && !known.prompted && !known.stopped) await prompt(sessions, request.sessionId, ctx.signal)
			// Otherwise already started, stopped, or begun and failed.
			return
		}
		const entry: Sessions[string] = { ref: request.ref, thread: null, prompted: false, stopped: false }
		sessions[request.sessionId] = entry
		save(sessions)
		const created = await once(`start a thread on ${request.ref}`, ctx.signal, async () => {
			const agent = await ctx.thread.agent()
			return agent.createThread({
				executor: 'orb',
				// Signed by Sidetrack, where only the list's admin sets it.
				project: request.repository,
				multiplayerTTLSeconds: null,
			})
		})
		if (!created) return
		entry.thread = created.value.id
		save(sessions)
		await prompt(sessions, request.sessionId, ctx.signal)
	}

	/** Send a started session's thread its start prompt, once. */
	const prompt = async (sessions: Sessions, sessionId: string, signal: AbortSignal) => {
		const entry = sessions[sessionId]
		const { ref } = entry
		const thread = entry.thread!
		entry.prompted = true
		save(sessions)
		const prompted = await once(`prompt ${thread} on ${ref}`, signal, () =>
			amp.threads.get(thread).appendUserMessage({ type: 'user-message', content: startMessage(ref) }),
		)
		if (prompted) amp.logger.log(`Started ${thread} on ${ref}.`)
	}

	/**
	 * Make one Amp call that must not be repeated, bounded by the delivery's
	 * deadline so a call that never answers can't hold up the deliveries
	 * queued behind it. Returns its result wrapped, or null, logged, when it
	 * fails or runs out of time; the caller has already recorded it as done.
	 */
	const once = async <T>(what: string, signal: AbortSignal, call: () => Promise<T>) => {
		try {
			const value = await new Promise<T>((resolve, reject) => {
				signal.addEventListener('abort', () => reject(new Error('the delivery ran out of time')), {
					once: true,
				})
				call().then(resolve, reject)
			})
			return { value }
		} catch (error) {
			amp.logger.log(
				`Couldn't ${what} (${String(error)}); not retrying, as it may have happened. ` +
					'Unassign and assign the agent again in Sidetrack to start over.',
			)
			return null
		}
	}
	let queue: Promise<void> = Promise.resolve()

	let url: string
	try {
		;({ url } = await amp.createWebhook({
			key: 'sidetrack-agent',
			headers: ['x-sidetrack-timestamp', 'x-sidetrack-signature'],
			// One delivery at a time, so each reads the state the last one left.
			handler: (event, ctx) => {
				const run = queue.then(() => handle(event, ctx))
				queue = run.catch(() => {})
				return run
			},
		}))
	} catch (error) {
		amp.logger.log(`Couldn't register the Sidetrack webhook: ${String(error)}`)
		return
	}

	// The URL is a credential: never logged, only written where the user can
	// read it from the Terminal tab.
	const urlPath = join(amp.system.cacheDirectory, 'webhook-url')
	mkdirSync(dirname(urlPath), { recursive: true })
	writeFileSync(urlPath, `${url}\n`, { mode: 0o600 })
	chmodSync(urlPath, 0o600)
	amp.logger.log(`Sidetrack dispatcher ready. Webhook URL written to ${urlPath}.`)
}
