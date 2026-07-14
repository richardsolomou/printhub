# PrintHub

For large existing libraries, use `ASSET_JOB_CONCURRENCY=1` under **Additional Environment Variables**. Each worker generally occupies one CPU core; higher values process multiple models simultaneously and can make an underpowered NAS unresponsive.

[PrintHub](https://github.com/richardsolomou/printhub) is a private, self-hosted 3D-print production queue for resin and FDM. Accept STL requests, manage mixed printer fleets, plan build plates, and track each copy through Queue, Printing, Finishing, and Ready while files stay on storage you control. No vendor cloud or printer account is required.

On a fresh install, the first person to open the web UI claims the admin account — open it right after deploying.
