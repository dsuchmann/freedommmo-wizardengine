# Blockers

No active blockers.

## Notes

- The agent cannot self-trigger turns or keep pressing `continue` by itself; the user still needs to send a message such as `continue` for each work turn. The persistent loop files let those turns run with minimal supervision.
- Browser/preview automation is unavailable in this session, so runtime verification is limited to code/lint checks and static review.
- If the preview reloads after file changes, player position should now restore from local storage instead of returning to spawn. Press `R` to intentionally clear position and reset to spawn.
- The user should report visible runtime/console errors from the preview in this session because the agent cannot automatically inspect the browser console without browser automation tools.
