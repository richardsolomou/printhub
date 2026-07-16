# PrintHub Prusa support worker

This sidecar builds against PrusaSlicer 2.9.6 at commit `b028299c770b8380ee81c921a2867d522f288123`. It accepts a prepared 3MF project, runs the PrusaSlicer SLA support pipeline, and returns the exact generated support and pad geometry as binary STL.

The worker is a separate AGPL-3.0-or-later program because it links to PrusaSlicer's `libslic3r`. PrintHub communicates with it only through the HTTP API in `server.py`; the main application remains MIT licensed. The complete corresponding worker source and pinned upstream source reference are provided in this directory and its Dockerfile.
