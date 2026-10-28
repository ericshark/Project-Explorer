# Static frontend on Vercel

## Summary

Local use needs the repository's supported Node version, package manager, and dependencies. Public hosting needs a successful production build and its static output. Visitors run the application in their browser; this recipe supplies no database, authentication service, or persistent backend.

## Run locally

1. Read the project's README and package-manager lockfile. Use its declared Node version.
2. Install locked dependencies (`npm ci`, or the project's pnpm/yarn equivalent).
3. Run the documented dev script, normally `npm run dev`. Open the printed localhost URL. If occupied, select another port using that project's supported arguments.
4. Stop with Ctrl+C. A dev or preview server is for local use; upload a production build for the public site.

## Deploy publicly

1. In Vercel, choose **Add New → Project**, connect GitHub, and import the repository and intended production branch.
2. Select the application root. For npm workspaces, retain the workspace root when dependencies require it.
3. Select the detected framework, usually Vite. Set build command `npm run build` and output directory `dist` unless the repository specifies another path.
4. Add only required production environment variables. `VITE_` values are public browser configuration: never put privileged secrets there. Redeploy after changing build-time variables.
5. Deploy. Check the generated HTTPS URL, assets, mobile layout, and a nested route after refresh.
6. For a client-side router, configure a Vercel rewrite from `/(.*)` to `/index.html` if needed. Do not use that blanket rewrite to replace API routes in a full-stack app.
7. Verify any external API URL is production-ready. A Vite `server.proxy` setting does not exist in the public static build.

For a browser-only SPA, place this in `vercel.json` at the Vercel project root:

```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

## Domain

The generated project URL is sufficient for demos. For an existing subdomain, follow [Connect a domain](/hosting/domains).

## Cost

Checked October 28, 2026: Vercel Hobby is $0 for eligible personal, non-commercial projects within quotas. Pro starts at $20 per developer/month with additional usage charges; choose it for commercial use or higher limits. Paying does not automatically make browser-side code faster. See [pricing](https://vercel.com/pricing) and [Hobby conditions](https://vercel.com/docs/plans/hobby).

Sources: [Vite deployment](https://vercel.com/docs/frameworks/frontend/vite), [rewrites](https://vercel.com/docs/rewrites), [environment variables](https://vercel.com/docs/environment-variables).
