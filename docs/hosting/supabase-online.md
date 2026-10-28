# Online features with Supabase

## Summary

Use this recipe only for an application already integrated with Supabase. Local use may work without cloud credentials; public online features need a hosted project, migrations/policies, Auth settings, and any functions or scheduled jobs that the application requires. Supabase is not a drop-in replacement for every custom backend.

## Run locally

1. Follow the app's README. Use its browser-only mode when available.
2. If testing the local Supabase stack, install its CLI and Docker-compatible runtime, then follow the repository's checked-in ports and configuration. Use development credentials only.
3. Stop the app processes and any local stack you started when finished.

## Deploy publicly

1. Create a separate production project. Select its region and keep development data separate.
2. Install the supported Supabase CLI. Authenticate and target the project before applying reviewed migrations:

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
supabase migration list
```

3. Deploy the application's checked-in Edge Functions, preserving its JWT/authentication configuration. Set function-only secrets in the dashboard/CLI; never put service-role or secret keys in browser variables.
4. Configure the hosted Auth Site URL and exact callback URLs. Enable only the sign-in methods used by the application, configure production email delivery, and test recovery/session refresh.
5. Add the project URL and public anon/publishable key to the frontend variables the code expects. Rebuild the frontend.
6. Test cross-account isolation, row-level-security policies, export/deletion, and failure/retry behavior through the hosted API.
7. Enable the documented maintenance/aggregation jobs using protected server-only secrets. Verify schedules actually run and confirm backup/restore arrangements.

## Cost

Checked October 28, 2026: Free $0, limited to two active projects, 500 MB database per project, and inactivity pausing after one week. Pro starts at $25/month for the organization with compute credits covering one Micro project; additional projects start around $10/month and usage can add charges. Pro includes daily backups with seven-day retention. Review quotas and enable a suitable production plan when uptime, retention, or usage requires it. [Pricing](https://supabase.com/pricing)

Sources: [environments/migrations](https://supabase.com/docs/guides/deployment/managing-environments), [Auth redirects](https://supabase.com/docs/guides/auth/redirect-urls), [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).
