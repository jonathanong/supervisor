# Evals

**Does an agent with the `supervisor` plugin follow each skill's guidance on a realistic request?**

Each case gives an agent a plain request without naming a skill. Graders check that the right skill loaded and that the agent made the intended decision. Running the same case without the plugin shows whether the skill changes the outcome.

## Current results

No cases or measured runs exist yet (0 cases).

When the first cases are added and measured, this section will show the latest single-run summary table with date, commit, agent model, judge model, attempts per arm, and total cost.

## What each case checks

No cases yet. See [EVALS.md](EVALS.md) for the per-case table as cases are added.

## How to read the numbers

- Report both arms (with and without the plugin) whenever a baseline arm applies; the gap between the arms is the result.
- Mark any case whose baseline arm passes at the top as a ceiling case: it checks loading and non-harm, not improvement.
- Give raw pass counts beside rates for small sample sizes (for example, `2 of 3`), and do not treat a single-attempt pilot as a measured score.

## What the suite does not measure

- Real-world skill loading frequency in a full multi-plugin environment.
- Live GitHub or external service mutations: fixtures stay synthetic and never write to hosted services.

## How to run it

No eval runner script is wired yet; the runner will be added alongside the first skill and eval case. Raw results will land in `evals/results/`, which git ignores.

## More

- [EVALS.md](EVALS.md): every case, what it checks, and its current score.
- [HISTORY.md](HISTORY.md): every measured run and every change to a case, grader, or fixture.
- [AGENTS.md](AGENTS.md): rules for adding, changing, running, and recording evals.
