# Connect a domain

## Summary

The registrar maintains ownership and renewal. The authoritative DNS provider holds records directing hostnames to services. Vercel/Render serve the application. These can be three different companies; adding a subdomain does not require transferring the registration or changing nameservers.

## Attach a hostname

1. Deploy and test using the hosting provider's generated HTTPS URL.
2. Add the intended hostname to that project's domain settings.
3. At your existing DNS provider, add exactly the A/AAAA/CNAME or verification records the host supplies. Do not copy old IP addresses from a guide. Preserve unrelated email and verification records.
4. If using Cloudflare, start with **DNS only** for the application record while verifying the origin and certificate. Proxied records additionally route HTTP through Cloudflare; that changes caching and client-IP handling and requires deliberate configuration.
5. Wait for host verification and HTTPS. Choose the canonical hostname and configure the other hostname to redirect if needed.
6. Update application public URLs, allowed origins, email links, and OAuth callbacks. Redeploy if these are build-time values.
7. Test HTTPS, login, redirects, API calls, and WebSockets from the final address. Keep the previous deployment available during migration and retain the old DNS values for rollback.

## Which address to choose

A provider URL is enough for previews and small demos. An existing-domain subdomain is useful for a portfolio project. Buy a separate domain only when an independent identity warrants annual renewal. Backend services can generally retain provider addresses. No custom Supabase domain is required for ordinary frontend integration.

## Cost

A subdomain under a domain you already own needs no separate registration. The parent domain still needs renewal, and hosting plans may impose custom-domain limits/charges. Checked October 28, 2026: Render Hobby includes two custom domains, Pro 15; additional domains cost $0.25/domain/month. Verify dashboard terms before adding many hostnames.

Sources: [Vercel domains](https://vercel.com/docs/domains/working-with-domains/add-a-domain), [Render domains](https://render.com/docs/custom-domains), [Cloudflare DNS](https://developers.cloudflare.com/dns/manage-dns-records/how-to/create-dns-records/).
