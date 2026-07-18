# Playwright Recording Artifacts

Target projects keep browser recordings under `.flowtrace/recordings/`:

```text
.flowtrace/recordings/
├── <id>.spec.ts          # Runnable Playwright Codegen output
├── <id>-auth.json        # Optional storage state; never commit secrets
├── <id>.metadata.json    # Recording metadata
└── <id>.raw.json         # Normalized technical steps after import
```

Business-action mappings belong to the target project:

```yaml
mappings:
  - locator: testid=purchase-submit
    semanticAction: SUBMIT
```

The importer writes a scenario draft under `.flowtrace/scenarios/`. Imported drafts are always `NEEDS_REVIEW` and disabled until actors, business actions and assertions have been confirmed.
