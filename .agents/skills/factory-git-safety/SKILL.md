---
name: factory-git-safety
description: Implement or review native Git operations, branch and worktree changes, source control safety, and disposable Git fixtures for Studio.
---

# Studio Git safety

1. Read [Git safety](../../../docs/GIT_SAFETY.md) and the assigned phase in [Roadmap](../../../docs/ROADMAP.md).
2. Bind each operation to the canonical worktree and applicable repository refs. Specify permitted execution paths and blocked Git config, attributes and repository states.
3. Show the user the direction, affected paths, and destination before mutation. Revalidate the approved state immediately before executing. Keep a recovery path for partial success.
4. Verify relevant dirty, ignored, conflict, drift and worktree cases using disposable fixtures and local bare remotes. Keep Git recovery independent of physical database recovery.
5. Record the actual verification, including Git for Windows when relevant, in [Progress](../../../docs/PROGRESS.md).
