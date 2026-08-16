---
name: Client component smoke-render harness
description: How to actually exercise a React component in this repo when it only exists behind a modal and there is no test framework.
---

Many admin UI components here are only reachable by clicking through a
dialog (no route, no query param opens them), and the repo has no test
runner — so neither a screenshot nor a unit test can verify them.

The rule: render the component with `react-dom/server`'s
`renderToStaticMarkup` from a throwaway `.tsx` script at the repo root,
run it with `tsx`, and assert on the stripped text / `data-testid`s.

**Why:** it is the only cheap way to prove a component mounts, reads its
props correctly, and produces the intended structure. `tsc` only proves
types; a Vite transform only proves it parses.

**How to apply:**
- Put the script at the repo ROOT so `@/*` and `@shared/*` tsconfig
  paths resolve.
- The root tsconfig sets `jsx: "preserve"`, which makes tsx use the
  classic runtime and the component dies with
  `ReferenceError: React is not defined`. Run with a temporary tsconfig
  that extends the root one and sets `jsx: "react-jsx"`:
  `npx tsx --tsconfig tmp-tsconfig.json tmp-render.tsx`.
- Wrap anything using TanStack Query in a `QueryClientProvider`; with no
  server the query just stays empty, which is a useful "catalog hasn't
  loaded yet" case.
- Stub RJSF field props by hand (`schema`, `formData`, `onChange`,
  `registry.formContext`, `fieldPathId`).
- Delete the script and the temp tsconfig when done — these are probes,
  not fixtures.
