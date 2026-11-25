# Loop 6: backlog → work

Work already sitting in a milestone should start without a person asking for it. Each tick, the supervisor matches ready issues to idle capacity.

[Back to the graph](graph.md)

1. **Pick ready issues.** An issue is ready when all of these hold:
   - it is in an open milestone
   - it has no claim and no open PR
   - it carries neither a blocked label nor a needs-human label
   - it is not on the hold list: issues waiting on a decision or a paid run
2. **Order.** Milestone due date first, then priority labels from critical to low, then age.
3. **Route.** Work in a repository's lane goes to that repository's orchestrator; the supervisor starts or restarts it if needed. Otherwise the supervisor dispatches its own worker. The worker posts a [claim](claims-and-taxonomy.md) as it starts.
4. **Merge as usual.** The [merge policy](merge-policy.md) decides. Most feature work matches no carve-out, so it ends as a reviewed PR waiting for a person. That is the intended stopping point.
5. **Limits.** A cap on running workers per machine, machine health (disk, memory, a benchmark that needs a quiet machine), and the usage rules in [dispatch.md](dispatch.md) bound how much runs at once.

## Dead and stuck workers

The supervisor notices workers that are idle, errored or gone, and machines that are down. It keeps enough handoff state to resume each piece of work (the branch, the PR, notes), and re-dispatches it, preferring a healthy machine.
