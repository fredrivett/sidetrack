import type { PluginAPI, ThreadID } from '@ampcode/plugin'
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
		`pull request open and ask on the item with add_comment.`
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
 * Which thread each Sidetrack session started. It makes a redelivered start
 * a no-op and lets a stop reach only the thread its start created. `thread`
 * is null between deciding to start and the thread existing, so a start that
 * crashed there isn't repeated (an orb is costly to start twice); assigning
 * again in Sidetrack makes a new session.
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
		} catch {
			return {}
		}
	}
	const save = (sessions: Sessions) => {
		mkdirSync(dirname(statePath), { recursive: true })
		writeFileSync(`${statePath}.tmp`, JSON.stringify(sessions, null, '\t'))
		renameSync(`${statePath}.tmp`, statePath)
	}

	let url: string
	try {
		;({ url } = await amp.createWebhook({
			key: 'sidetrack-agent',
			headers: ['x-sidetrack-timestamp', 'x-sidetrack-signature'],
			handler: async (event, ctx) => {
				const secret = process.env[SECRET_ENV]
				if (!secret) {
					amp.logger.log(`Ignored a request: ${SECRET_ENV} isn't set.`)
					return
				}
				const request = readAgentRequest(
					event.body,
					event.headers,
					secret,
					new Date(event.receivedAt),
				)
				// Refused requests aren't retried: the same bytes would be refused again.
				if ('refused' in request) {
					amp.logger.log(`Refused request ${event.id}: ${request.refused}.`)
					return
				}
				const sessions = load()
				const known = sessions[request.sessionId]

				if (request.type === 'stop') {
					if (!known?.thread || known.stopped) return
					await amp.threads
						.get(known.thread)
						.appendUserMessage(
							{ type: 'user-message', content: stopMessage(request.ref) },
							{ steer: true },
						)
					known.stopped = true
					save(sessions)
					return
				}

				if (known?.prompted || (known && !known.thread)) return
				let entry = known
				if (!entry) {
					entry = { ref: request.ref, thread: null, prompted: false, stopped: false }
					sessions[request.sessionId] = entry
					save(sessions)
					try {
						const agent = await ctx.thread.agent()
						const thread = await agent.createThread({
							executor: 'orb',
							// Signed by Sidetrack, where only the list's admin sets it.
							project: request.repository,
							multiplayerTTLSeconds: null,
						})
						entry.thread = thread.id
					} catch (error) {
						// No thread was made, so a retry may try again.
						delete sessions[request.sessionId]
						save(sessions)
						throw error
					}
					save(sessions)
				}
				if (!entry.thread) return
				await amp.threads
					.get(entry.thread)
					.appendUserMessage({ type: 'user-message', content: startMessage(request.ref) })
				entry.prompted = true
				save(sessions)
				amp.logger.log(`Started ${entry.thread} on ${request.ref}.`)
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
