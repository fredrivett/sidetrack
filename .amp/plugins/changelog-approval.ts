import type { PluginAPI } from '@ampcode/plugin'

export const description =
	"Stops git push and gh pr create while the branch has a changelog entry Fred hasn't approved, and asks him to approve or reword each one. Amp counterpart of the changelog hooks in .claude/settings.json."

const GATED = /\b(git\s+push|gh\s+pr\s+create)\b/

type Pending = { file: string; type: string; pr: number[]; text: string; hash: string }

export default function (amp: PluginAPI) {
	amp.on('tool.call', async (event, ctx) => {
		const shell = amp.helpers.shellCommandFromToolCall(event)
		if (!shell || !GATED.test(shell.command) || !amp.system.workspaceRoot) return { action: 'allow' }
		const root = amp.helpers.filePathFromURI(amp.system.workspaceRoot)
		const script = `${root}/scripts/changelog-approval.ts`

		const run = await ctx.$`cd ${root} && ./node_modules/.bin/tsx ${script} pending`
		// A broken entry or missing dependencies: let the push go, and the
		// Changelog check in CI reports the entry.
		if (run.exitCode !== 0) return { action: 'allow' }
		const entries = JSON.parse(run.stdout || '[]') as Pending[]
		if (entries.length === 0) return { action: 'allow' }

		const reworded: string[] = []
		for (const e of entries) {
			let answer: Record<string, string> | undefined
			try {
				answer = await ctx.ui.confirm({
					title: 'Approve changelog entry?',
					message: `${e.type} · ${e.pr.map((n) => `#${n}`).join(' ')} · changes/${e.file}\nIt appears on /changelog once this merges. Reword it here if you like.`,
					fields: [{ name: 'text', label: 'Entry', value: e.text, multiline: true }],
					confirmButtonText: 'Approve',
					requireHuman: true,
				})
			} catch (error) {
				if (!amp.helpers.isPluginUINotAvailableError(error as Error)) throw error
				return {
					action: 'reject-and-continue',
					message: `Blocked: changes/${e.file} needs Fred's approval and no one can answer here. Ask him in the thread.`,
				}
			}
			if (!answer) {
				return {
					action: 'reject-and-continue',
					message: `Blocked: Fred didn't approve changes/${e.file}. Ask him how he'd like it worded, or whether it needs an entry at all.`,
				}
			}
			const text = answer.text.trim()
			if (text === e.text) {
				await ctx.$`cd ${root} && ./node_modules/.bin/tsx ${script} approve ${e.hash}`
			} else {
				reworded.push(`changes/${e.file}: ${text}`)
			}
		}
		if (reworded.length) {
			return {
				action: 'reject-and-continue',
				message: `Fred reworded these changelog entries. Use his text exactly, commit, and run the command again (he'll see them once more):\n${reworded.join('\n')}`,
			}
		}
		return { action: 'allow' }
	})
}
