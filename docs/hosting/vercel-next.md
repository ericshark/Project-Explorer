# Next.js on Vercel

## Summary

Local use needs the project's Node version and package manager. Public hosting needs Vercel and the correct Next.js root. Static exports publish files; dynamic route handlers require a server runtime. A database is needed only when the project actually uses one.

## Run locally

1. Install dependencies using the checked-in lockfile and declared Node version.
2. Run the repository's dev command. For example:

```bash
npm ci
npm run dev -- --port 3001
```

3. Open the printed URL. Choose another available port if necessary. Stop with Ctrl+C.

## Deploy publicly

1. Import the GitHub repository in Vercel and choose the Next.js application directory and production branch.
2. Select **Next.js**. Use the repository's build script (`npm run build` or `pnpm build`). Match its package manager and Node requirements.
3. Inspect `next.config.*`: `output: 'export'` creates an `out` directory. Preserve that mode for a static-export project; use `out` as the output when the deployment settings require an override. Do not enable static export for an application with dynamic API routes.
4. Add required server environment variables before deployment. Only deliberately public browser configuration belongs in `NEXT_PUBLIC_` variables. Configure preview environments separately.
5. Deploy and test pages, assets, redirects, metadata, and any API route. Test server functions after cold start; check upstream timeouts and per-instance cache behavior.
6. Attach a domain if useful using [Connect a domain](/hosting/domains). Changing variables or generated metadata requires a fresh deployment.

## Cost

Checked October 28, 2026: Hobby $0 for eligible personal/non-commercial projects within limits; Pro starts at $20 per developer/month plus usage. Dynamic functions consume runtime resources; large traffic or expensive data refreshes can require an upgrade. See [pricing](https://vercel.com/pricing) and [Hobby limits](https://vercel.com/docs/plans/hobby).

Sources: [Next.js on Vercel](https://vercel.com/docs/frameworks/full-stack/nextjs), [environment settings](https://vercel.com/docs/environment-variables).
