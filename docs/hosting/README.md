# Hosting guide content

The Hosting page reads Markdown and `catalog.json` through the local server. These shared recipes contain no personal project inventory. Project Explorer itself stays on localhost; this feature is documentation, not a deployment runner.

## Personal guides

Create `.hosting/catalog.json` and Markdown files under `.hosting/` in the repository root. The whole folder is ignored by Git. The catalog is a JSON array. Each entry has this shape:

```json
{
  "id": "sample-app",
  "title": "Sample app",
  "description": "Local and public setup.",
  "category": "Simple frontend",
  "order": 10,
  "projects": [{ "id": "folder--sample-app", "name": "Sample app" }],
  "providers": ["Vercel"],
  "cost": "See the guide for current limits.",
  "file": "sample-app.md"
}
```

Use stable unique lowercase/hyphen IDs; IDs must not collide with shared recipes. `projects` maps to the IDs returned by `/api/projects`. Unavailable projects appear as text, not broken links. Within each list (Your guides and Shared guides), guides sort by ascending `order`, then title.

Guide links use `/hosting/guide-id`; section links use `#heading-name` (lowercase, spaces become hyphens). HTTP(S) links open externally. Markdown is rendered without embedded HTML or images. File paths never appear in the catalog API.

Each guide should have Summary, Run locally, Deploy publicly, an optional Domain section, and Cost with dated official sources. Explain local/public dependencies, required versus optional services, launch blockers, and checks. Never store actual credentials. Runtime reads pick up file changes on reload; a malformed private catalog leaves shared recipes available with a warning.

Back up `.hosting/` separately: ignored files do not travel with Git. Check with `git check-ignore .hosting/catalog.json` and inspect staged changes before pushing. Adding an ignore rule does not erase content from existing Git history; review previously published content separately if necessary.
