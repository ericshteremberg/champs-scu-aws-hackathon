# Real-data workspaces

Normal local and production workspaces show only imported or manually entered cases. The sample loader is removed from the dashboard. Existing cases marked `source: demo`, their evidence/reports, case-linked access requests, and demo activity are excluded by both backend serializers. Direct case access and investigation requests also reject those cases. No real customer records are deleted or identified by a name/email heuristic.

Old fixture rows remain stored but inaccessible in the product; this change does not purge the databases. Empty workspaces show zero totals and actions to connect a source or create a case. Production sample seeding is rejected even if a fixture environment flag is accidentally set. The design-screen gallery also returns 404 outside fixture environments.

Automated Vitest runs use `NODE_ENV=test`. Browser/API fixture tests and editable design previews require a local development server started with `CAUSALITY_TEST_FIXTURES=true` and `NODE_ENV=development`. Never set this flag on a shared workspace. Production builds always ignore it. Synthetic test files and the clearly illustrative landing-page walkthrough are retained; they are not customer records or connected to the compiler.

Deploy both the frontend and private AWS backend to apply this to the shared site. This does not change connected account permissions or submit dispute evidence.
