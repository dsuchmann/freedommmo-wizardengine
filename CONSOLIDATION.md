# Codebase Consolidation Runbook (6 agents → one main)

**Generated 2026-06-21 by the building/door agent.** Goal: every agent's work saved, then converged onto `master` and pushed to GitHub.

## Current state (verified)

Remote: `origin` = github.com/dsuchmann/freedommmo-wizardengine

Worktrees (each a separate folder + index):
| Folder | Branch | Notes |
|---|---|---|
| `projects/default` (MAIN, **shared by multiple agents**) | `motion-eval-system` | the trunk of the work; +107 unique vs perf-opt |
| `projects/perf-opt` | `perf-opt` | **17 commits NOT in motion-eval-system** (the perf work) |
| `projects/f2-pool` | `f2-instance-pool` | behind; check before discarding |
| `projects/f5-wiring` | `master` | the eventual target |

### Backup status — ✅ all *committed* work is on GitHub
- `origin/motion-eval-system` pushed up to `f93469f8e` (contains my work + every committed change on the trunk).
- `master`'s entire history is an **ancestor of** `motion-eval-system`, so its 746 commits are safe on `origin/motion-eval-system` even though `origin/master` is behind.
- `origin/perf-opt` is up to date.
- **Only at-risk work: uncommitted WIP in the shared main folder** (≈13 files: `genesis.js`, `settlement-discovery.js`, `main.js`, `field2-animator.js`, `biomes.js`, `chunk-provider.js`, `wang-image-list.js`, `lg-catalog.js`, `overmap.js`, `bulk_generate_f6.py`, …). These are in **no commit** — they vanish if the tree is reset. **Their owners must commit them.**

## Step 0 — every agent commits its WIP (do this first)

> Commit your in-progress work to your current branch now: `git add <your files, BY NAME>` then `git commit`.
> **If you're in the shared main folder** (`projects/default`): stage files **by name only — never `git add -A` / `git add .`** — the shared index will otherwise sweep up another agent's uncommitted work into your commit.
> **Don't** merge to master, push, or `git reset`. Reply with: your **branch name**, **latest commit hash**, and the **files you committed**.

Agents in the `perf-opt` / `f2-pool` / `f5-wiring` worktrees are isolated and safe — the by-name warning is specifically for the main folder.

## Step 1 — back up (coordinator, after everyone has replied)

```bash
git push origin motion-eval-system perf-opt f2-instance-pool   # non-destructive; saves everything remotely
```

## Step 2 — merge perf-opt into the trunk (the one careful step)

```bash
git switch motion-eval-system
git merge perf-opt
```
**Conflicts are exactly 2 files** (verified via `git merge-tree`): `src/render/field2-animator.js` and `src/render/gl-compositor.js` — both render/perf files. Resolve with the agent who owns the perf/animation work (keep both perf optimizations and the latest animation logic). `src/main.js` auto-merges. **Note:** `field2-animator.js` also has uncommitted WIP in the main folder — commit that (Step 0) *before* this merge.

After resolving: `git commit`, then `git push origin motion-eval-system`.

## Step 3 — publish to main

```bash
git switch master            # (in the f5-wiring worktree, which holds master)
git merge --ff-only motion-eval-system   # clean: master is 0 ahead of motion-eval-system
git push origin master
```

## Then cycle

Repeat Step 0→3 as each agent's remaining WIP lands, until every branch is merged and `origin/master` == every agent's work. Once converged, **switch to per-agent worktrees permanently** so the shared-index hazard can't recur.
