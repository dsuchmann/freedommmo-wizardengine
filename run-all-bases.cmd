@echo off
REM Detached ALL-BASES upscale run: F2/F3/F4/F5/large_objects, all biomes, base-only.
REM Resumable + idempotent: skips existing @384 files, honors field-studio curation omits.
REM Safe to close and re-run anytime. Needs ComfyUI on :8188. Log: scripts\tree-upscale\_allbases_run.log
title all-bases upscale run (close this window to stop)
cd /d "%~dp0"
echo === all-bases run (detached) started %date% %time% === >> scripts\tree-upscale\_allbases_run.log
for %%F in (small_flora small_scatter medium_flora medium_objects large_objects) do (
  echo. >> scripts\tree-upscale\_allbases_run.log
  echo ===== FIELD %%F  %date% %time% ===== >> scripts\tree-upscale\_allbases_run.log
  python scripts\tree-upscale\comfy-batch.py --field %%F --base-only >> scripts\tree-upscale\_allbases_run.log 2>&1
)
echo === ALL FIELDS FINISHED %date% %time% === >> scripts\tree-upscale\_allbases_run.log
echo.
echo ALL FIELDS FINISHED. See scripts\tree-upscale\_allbases_run.log
pause
