# Shopper journey tests

The same Playwright tests run against localhost and the deployed AWS frontend.
The target is selected with `BASE_URL`; no AWS-specific copy of the tests is needed.

## Local

```powershell
pnpm dev
pnpm e2e -- --project=desktop --project=mobile --workers=1
```

## AWS deployment

Set `BASE_URL` to the deployed frontend URL supplied by the deployment owner:

```powershell
$env:BASE_URL = "https://your-deployed-frontend.example"
pnpm e2e -- --project=desktop --project=mobile --workers=1
```

The AWS run must be recorded separately from the local run. Save the Playwright
HTML report and the terminal summary with the deployment URL, commit SHA, date,
browser projects, passed/failed counts, and any service or infrastructure
shortfall. Do not commit the report, videos, traces, or screenshots.

These tests verify browser journeys only. Load, correctness-reference baskets,
scale-out/scale-in, and instance-termination evidence are separate evaluation
activities.
