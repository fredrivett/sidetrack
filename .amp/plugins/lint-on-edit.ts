import type { PluginAPI } from '@ampcode/plugin'

export const description =
	'Runs ESLint on files the agent edits and appends any errors to the edit result, so the agent fixes them in the same turn. Amp counterpart of the PostToolUse hook in .claude/settings.json.'

const LINTED = /\.([cm]?[jt]s|[jt]sx)$/

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
		// ESLint exits 1 for lint errors. Any other failure (2 for a config error or
		// crash, 127 when dependencies aren't installed, a killed process) says
		// nothing about the edit, so skip it; CI still runs the full lint.
		const errors = (lint.stdout + lint.stderr).trim()
		if (lint.exitCode !== 1 || !errors) return

		const report = `ESLint errors in the edited files (fix them before continuing):\n${errors}`
		const output = event.output
		if (Array.isArray(output)) {
			return { status: 'done', output: [...output, { type: 'text', text: report }] }
		}
		if (output && typeof output === 'object') {
			// Keep object results (edit_file's diff) intact so they still render as a diff.
			return { status: 'done', output: { ...output, eslint: report } }
		}
		return { status: 'done', output: `${String(output ?? '')}\n\n${report}` }
	})
}
