# Gnome Shell Extension Elgato light control for Linux
[![License](https://img.shields.io/badge/licence-GPL--2.0-orange?logo=appveyor&style=for-the-badge)](https://git.netadvising.de/alex/gnome-shell-extension-elgato-light-control/src/branch/master/COPYING)
[![Donate](https://img.shields.io/badge/Donate-PayPal-blue?logo=appveyor&style=for-the-badge)](https://www.paypal.com/donate?hosted_button_id=WX4VWRKS89666)

Control all your Elgato Key Lights with one Control.

This extension is only tested with gnome-shell 3.38 right now:

    * master: 3.38

![Screenshot](https://git.netadvising.de/alex/gnome-shell-extension-elgato-light-control/raw/branch/master/screenshot.png)

![Preferences](https://git.netadvising.de/alex/gnome-shell-extension-elgato-light-control/raw/branch/master/screenshot-prefs.png)

## Features
- [x] Use multiple Elgato devices.
- [x] Turn on/off light.
- [x] Adjust brightness.
- [x] Adjust light temperature.

## TODO
- [x] Cleanup and reorganise code base.
- [x] Improve design and texts.
- [ ] Adding multiple languages (english / german).
- [ ] Device limitation to 5.
- [ ] Enable device finder (flashing).
- [x] Auto discovery for Elgato devices.

## Requirements
Here is a list of required programs that Elgato light control depends on:
* [npm](https://www.npmjs.com/get-npm) (for dependencies installation)
* [nodejs](https://nodejs.org) (v8.6 or newer)

Please make sure you have all of the above installed.

## Preparation
### Ubuntu
Having enabled universe repo run:
```
sudo apt install npm
```
Update npm:
```
sudo npm install -g npm
```

### Fedora
Having enabled rpm fusion repos run:
```
sudo dnf install npm
```

### Arch
```
sudo pacman -S npm nodejs
```

## Download & Installation from e.g.o
Not available right now.

## Download & Installation
    git clone https://git.netadvising.de/alex/gnome-shell-extension-elgato-light-control && cd gnome-shell-extension-elgato-light-control
    glib-compile-schemas --strict --targetdir=elgato-light-control@netadvising.de/schemas/ elgato-light-control@netadvising.de/schemas
    cp -r elgato-light-control@netadvising.de ~/.local/share/gnome-shell/extensions

Restart the shell and then enable the extension.

## Install npm dependencies
**Before scanning for devices** you **must** install some additional npm packages.

Go to `Settings -> Installation` and click `Install npm modules` button.

You must have `npm` and `nodejs` installed prior to this step.
