# Parallel development with Git worktrees

1. Open the repository and commit a suitable shared base. In **Git Studio → Worktrees**, select a base branch, enter a new folder name, and optionally name a new feature branch. Choose the destination parent in the system picker. Review the commit and destination before confirming.
2. Use **Open separately** and select the exact registered folder to admit it as another Studio tab. Use **Inspect** to see status for an independently selected checkout. Each worktree has its own working files and index. Branch refs and stash history are shared.
3. Open each checkout in its own VS Code window or Codex session using the displayed directory. Verify the path with `git status --short --branch` and `git rev-parse --git-common-dir`. Commit each feature in its own checkout.
4. Configure separate ignored environment files or process variables, service ports, and PostgreSQL development databases or namespaces. Use separate build output in each checkout. Apply reviewed SQL explicitly to its intended development target.
5. In the destination checkout, use **Integrate** to review merge, rebase or cherry-pick. For a dirty branch, cancel and commit separately, explicitly stash, or create another checkout. Review the branch switch again after stashing. Restore the stash in the intended checkout.
6. For conflicts, inspect **Base**, **Ours** and **Theirs**. Reveal the file in the system file manager and open it in your editor. Save the resolution, then use **Review Resolution** to stage that file. Read the rebase-specific side labels. Use **Review Continue** or **Review Abort** for Studio-owned operations. Save external copies of edits you want to keep before aborting.
7. Close the linked Studio tab and use another worktree to review removal. Save ignored environment or build data first. Studio requires a clean checkout and protects locked or missing worktrees.

The supported layout uses Git's reciprocal absolute local worktree registration. Custom or relative gitfiles, submodules, interactive rebase, bulk cherry-picking and operations started in other clients require external tooling. Git recovery and PostgreSQL recovery are independent.
