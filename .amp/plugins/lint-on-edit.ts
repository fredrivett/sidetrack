import type { PluginAPI } from '@ampcode/plugin'

export const description =
	'Runs ESLint on files the agent edits and appends any errors to the edit result, so the agent fixes them in the same turn. Amp counterpart of the PostToolUse hook in .claude/settings.json.'

const LINTED = /\.(ts|tsx|mts|js|mjs)$/

export default function (amp: PluginAPI) {
	amp.on('tool.result', async (event, ctx) => {
		if (event.status !== 'done' || !amp.system.workspaceRoot) return
		const root = amp.helpers.filePathFromURI(amp.system.workspaceRoot)
		const files = (amp.helpers.filesModifiedByToolCall(event) ?? [])
			.map((uri) => amp.helpers.filePathFromURI(uri))
			.filter((path) => path.startsWith(`${root}/`) && LINTED.test(path))
		if (files.length === 0) return

		// --quiet reports errors only, matching `pnpm lint --quiet` in the Claude hook.
		const lint = await ctx.$`cd ${root} && ./node_modules/.bin/eslint --quiet --no-warn-ignored ${files}`
		if (lint.exitCode === 0) return

		const report = `ESLint errors in the edited files (fix them before continuing):\n${(lint.stdout + lint.stderr).trim()}`
		// Keep object results (edit_file's diff) intact so they still render as a diff.
		const output =
			event.output && typeof event.output === 'object' && !Array.isArray(event.output)
				? { ...event.output, eslint: report }
				: `${String(event.output ?? '')}\n\n${report}`
		return { status: 'done', output }
	})
}
