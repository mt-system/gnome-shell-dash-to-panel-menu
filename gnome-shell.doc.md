To find useful *poor* documentation when coding Gnome-Shell documentation

https://gjs-docs.gnome.org/
https://gitlab.gnome.org/GNOME/gnome-shell

Un-official Seed Documentation https://www.roojs.com/seed/gir-1.2-gtk-3.0/gjs/index.html

GNOME shell: Javascript Source Documentation (extensions development)
https://mathematicalcoffee.blogspot.com/2012/09/gnome-shell-javascript-source.html


Requirements and tips for getting your GNOME Shell Extension approved
https://blog.mecheye.net/2012/02/requirements-and-tips-for-getting-your-gnome-shell-extension-approved/

https://gjs.guide/guides/gobject/basics.html#contents
https://wiki.gnome.org/Projects/GnomeShell/Extensions/MigratingShellClasses
https://gjs.guide/extensions/
https://gjs.guide/guides/

https://wiki.gnome.org/Projects/GnomeShell/Extensions
https://wiki.gnome.org/Attic/GnomeShell/Extensions/Writing


https://wiki.gnome.org/Attic/GnomeShell/...
https://wiki.gnome.org/Attic/GnomeShell/Development

Running GNOME Shell
To open a nested gnome-shell session in Wayland do:

dbus-run-session -- gnome-shell --nested --wayland

This allows useful set ups such as multimonitor and different scales, for example, to run two monitors with a DPI scale of 1 for the first and DPI scale 2 for the second:

dbus-run-session -- env MUTTER_DEBUG_NUM_DUMMY_MONITORS=2 MUTTER_DEBUG_DUMMY_MONITOR_SCALES=1,2 gnome-shell --nested --wayland

Resolution of each can be adjusted in the GNOME control center inside the generated window with the new session.



Open Looking Glass ==> Alt + F2



Migration to Gnome Shell 40
https://gjs.guide/extensions/upgrading/gnome-shell-40.html#applications-grid


GJS source code
https://gitlab.gnome.org/GNOME/gjs/