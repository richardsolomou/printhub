# PrintHub

For large existing libraries, use `ASSET_JOB_CONCURRENCY=1` under **Additional Environment Variables**. Each worker generally occupies one CPU core; higher values process multiple models simultaneously and can make an underpowered NAS unresponsive.

[PrintHub](https://github.com/richardsolomou/printhub) is a privacy-first, self-hosted resin production queue. Customers upload STLs and each copy moves through Queue, Printing, Washing, Curing, and Ready while files stay on storage you control.

On a fresh install, the first person to open the web UI claims the admin account — open it right after deploying.
