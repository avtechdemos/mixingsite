Mixing Line Live
================

Static demo of a remote view of the mixing line. The batch is simulated.
Nothing in this folder is connected to the plant.

HOW TO PUBLISH (GitHub Pages)
-----------------------------
Upload the CONTENTS of this Demo folder as the repository root
so index.html is at the top level. Do not upload the parent MixingSite
folder unless the live URL should include extra folders.

Relative paths are used (css/, js/, images/), so the site works at either:
  https://yourname.github.io/
  https://yourname.github.io/YourRepo/

Open index.html in a browser to run it locally. No build step and no server
are required.

WHAT PLAYS
----------
One batch takes about 40 seconds. The screen updates about once a second.
Each update moves the plant clock forward 10 seconds.

Pause freezes the batch. Click a component in the list or on the line
diagram to open current values, recent samples, and batch history.

Example limits in the demo are not plant standards.
