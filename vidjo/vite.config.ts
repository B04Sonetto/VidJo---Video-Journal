import { sentrySvelteKit } from '@sentry/sveltekit/vite';
import tailwindcss from '@tailwindcss/vite';
import adapterNode from '@sveltejs/adapter-node';
import adapterVercel from '@sveltejs/adapter-vercel';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

// Vercel sets VERCEL=1 while building. Locally we use adapter-node so `npm run
// build` does not need the symlink permissions adapter-vercel requires on Windows.
const adapter = process.env.VERCEL ? adapterVercel() : adapterNode();

export default defineConfig({
	plugins: [
		sentrySvelteKit({
			org: 'sean-carlo-masaya',
			project: 'vidjo-video-journal'
		}),
		tailwindcss(),
		sveltekit({
			// Registered manually in `hooks.client.ts` so a blocked worker script
			// (e.g. a deployment behind SSO) cannot surface as an unhandled error.
			serviceWorker: { register: false },
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			adapter
		})
	]
});
