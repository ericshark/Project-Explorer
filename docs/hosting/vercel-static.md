# Deploy a frontend on Vercel

## Run locally

Use the Node version and package manager from the project's README or lockfile. For npm projects, run `npm ci` then `npm run dev` and open the printed URL.

## Deploy publicly

1. Import the GitHub repository in Vercel. Select the production branch and app root. Keep the workspace root if the build needs workspace dependencies.
2. Match the project's Node version and package manager. Use its build script (for example, `npm run build`).

   | App                             | Preset  | Build output      |
   | ------------------------------- | ------- | ----------------- |
   | Vite                            | Vite    | `dist` by default |
   | Next.js with `output: 'export'` | Next.js | `out`             |
   | Next.js with server routes      | Next.js | Framework default |

3. Set required variables for each deployment environment. `VITE_` and `NEXT_PUBLIC_` variables are public. A Vite development proxy doesn't run in production, so configure a production API URL if the frontend uses one.
4. Deploy and check the generated HTTPS URL, including deep-link refresh and any API routes. For a browser-only Vite app with client-side routing, add this to `vercel.json` if refresh returns 404:

   ```json
   {
     "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
   }
   ```

## Domain

Use the generated URL or [connect a domain](/hosting/domains).

## Cost

Check [Vercel pricing](https://vercel.com/pricing) and [Hobby eligibility](https://vercel.com/docs/plans/hobby) before deploying. See [Vite on Vercel](https://vercel.com/docs/frameworks/frontend/vite) and [Next.js on Vercel](https://vercel.com/docs/frameworks/full-stack/nextjs) for framework details.
