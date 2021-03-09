
#!/bin/sh

rm -f elgato-light-control@netadvising.de.zip
glib-compile-schemas --strict --targetdir=elgato-light-control@netadvising.de/schemas/ elgato-light-control@netadvising.de/schemas
cd elgato-light-control@netadvising.de && zip -r ../elgato-light-control@netadvising.de.zip *
