# PrintHub

For large existing libraries, add `ASSET_JOB_CONCURRENCY=2` under **Additional Environment Variables** when the prints dataset is HDD-backed. Use `4` for SSD-backed pools and increase only when storage latency remains low during asset backfill.

[PrintHub](https://github.com/richardsolomou/printhub) is a self-hosted 3D print request queue. Friends or customers upload STLs to a Kanban board (To Do, In Progress, Done), and the files stay ordinary files on storage you control.

On a fresh install, the first person to open the web UI claims the operator account — open it right after deploying.
