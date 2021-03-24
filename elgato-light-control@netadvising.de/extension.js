/* extension.js
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

/* exported init */

const GETTEXT_DOMAIN = "elgato-keylight-control-extension";
const { GObject, St, Shell } = imports.gi;
const Gettext = imports.gettext.domain(GETTEXT_DOMAIN);
const _ = Gettext.gettext;
const Local = imports.misc.extensionUtils.getCurrentExtension();
const Helper = Local.imports.helper;
const Settings = Helper.getSettings(Local.path);
const ExtensionUtils = imports.misc.extensionUtils;
const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const Lang = imports.lang;
const Slider = imports.ui.slider;
const { debounce, setInterva, getSettings } = Local.imports.convenience;
const Gio = imports.gi.Gio;
const Soup = imports.gi.Soup;
const GLib = imports.gi.GLib;

class ElgatoKeyLight {
  constructor(url, httpSession) {
    this._url = "http://" + url + "/elgato/lights";
    this._httpSession = httpSession;
  }

  update(light) {
    let message = Soup.Message.new("PUT", this._url);
    var body = JSON.stringify({ lights: [light] });

    message.set_request("application/json", 2, body);
    this._httpSession.queue_message(message, function (httpSession, message) {
      global.log(message.response_body.data);
    });
  }

  status(callback, object) {
    let message = Soup.Message.new("GET", this._url);
    this._httpSession.queue_message(message, function (httpSession, message) {
      const lights = JSON.parse(message.response_body.data).lights;
      callback(lights[0], object);
    });
  }
}

const ElgatoKeyLightButton = GObject.registerClass(
  class ElgatoKeyLightButton extends PanelMenu.Button {
    _init() {
      super._init(0.0, _("ElgatoKeyLight"));

      this._settings = getSettings();
      
      let box = new St.BoxLayout({ style_class: "panel-status-menu-box" });

      let iconPath = `${Local.path}/icons/brightness-display-symbolic.svg`;
      let gicon = Gio.icon_new_for_string(`${iconPath}`);
      box.add_child(
        new St.Icon({ gicon: gicon, style_class: 'system-status-icon'})
      );
      box.add_child(PopupMenu.arrowIcon(St.Side.BOTTOM));
      this.add_child(box);
      
      this._switchSubmenuitem = [];
      this._temperatureSlider = [];
      this._switchmenuitem = [];
      this._brightnessSlider = [];
      this._devices = [];
      this._elgatoKeyLight = [];
      this._temperatureSliderChangedId = [];
      this._brightnessSliderChangedId = [];
      this._disableLightRequests = false;

      this._settings.connect(`changed::elgato-devices`, () =>
        this._updateDevices()
      );
      this._updateDevices();

      this._deviceExistsExists = this._devices.length > 0;
    }

    _refreshGui() {
      this._deviceExistsExists = this._devices.length > 0;

      this._resetUI();

      if (this._deviceExistsExists === true) {
        this._createOnOffSwitch();
        this._createBrightnessSlider();
        this._createTempratureSlider();
        this._getLightsStatus();
      }

      this._createSettingsMenuItem();
    }

    _bindSwitchControls(i) {
      this._switchmenuitem[i].connect("toggled", () => this._toggle(i));
    }

    _bindBrightnessSliderControls(i) {
      this._brightnessSliderChangedId[i] = this._brightnessSlider[i].connect(
        "notify::value",
        debounce(() => this._brightnessChanged(i), 500)
      );
    }

    _bindTemperatureSliderControls(i) {
      this._temperatureSliderChangedId[i] = this._temperatureSlider[i].connect(
        "notify::value",
        debounce(this._temperatureChanged.bind(this, i), 500)
      );
    }

    _unbindControls() {
      for (let i = 0; i < this._devices.length; i++) {
        this._brightnessSliderChangedId[i] = null;
        this._temperatureSliderChangedId[i] = null;
        this._switchmenuitem[i] = null;
      }
    }

    _getLightsStatus() {
      let device = {};
      this._disableLightRequests = true;
      for (let i = 0; i < this._devices.length; i++) {
        device = this._devices[i];
        this._elgatoKeyLight[i] = new ElgatoKeyLight(
          device.ip + ":" + device.port,
          new Soup.Session()
        );
        this._getLightStatus(i);
      }
      this._disableLightRequests = false;
    }

    _getLightStatus(i) {
      this._elgatoKeyLight[i].status(function (light, self) {
        self._brightnessSlider[i].value = light.brightness / 100.0;
        const temperature = 1000000 / light.temperature;
        self._temperatureSlider[i].value = (temperature - 2900) / (7000 - 2900);
        self._switchmenuitem[i].setToggleState(light.on == "1");
        self._bindSwitchControls(i);
        self._bindBrightnessSliderControls(i);
        self._bindTemperatureSliderControls(i);
      }, this);
    }

    _resetUI() {
      this._unbindControls();
      this.menu.removeAll();
    }

    _createOnOffSwitch() {
      let devName = "";
      let device = {};

      if (this._devices.length > 1) {
        for (let i = 0; i < this._devices.length; i++) {
          device = this._devices[i];
          devName = device.friendlyName || "unknown";

          this._switchSubmenuitem[i] = new PopupMenu.PopupSubMenuMenuItem(
            devName,
            true
          );
          this._switchmenuitem[i] = new PopupMenu.PopupSwitchMenuItem("Light", {
            state: false,
          });
          this._switchmenuitem[i].setToggleState(false);
          this._switchSubmenuitem[i].menu.addMenuItem(this._switchmenuitem[i]);
          this.menu.addMenuItem(this._switchSubmenuitem[i]);
        }
      } else {
        this._switchmenuitem[0] = new PopupMenu.PopupSwitchMenuItem("Light", {
          state: false,
        });
        this._switchmenuitem[0].setToggleState(false);

        this.menu.addMenuItem(this._switchmenuitem[0]);
      }
    }

    _createBrightnessSlider() {
      if (this._devices.length > 1) {
        for (let i = 0; i < this._devices.length; i++) {
          this._switchSubmenuitem[i].menu.addMenuItem(
            this._createSingleBrightnessSlider(i)
          );
        }
      } else {
        this.menu.addMenuItem(this._createSingleBrightnessSlider(0));
      }
    }

    _createSingleBrightnessSlider(i) {
      this._brightnessSlider[i] = new Slider.Slider(0);
      this._brightnessSlider[i].accessible_name = _("Brightness");
      let iconPath = `${Local.path}/icons/night-light-symbolic.svg`;
      let gicon = Gio.icon_new_for_string(`${iconPath}`); 
      let brightnessSlider_icon = new St.Icon({
        gicon: gicon,
        style_class: "popup-menu-icon",
      });
      let item = new PopupMenu.PopupBaseMenuItem({ activate: false });
      item.add(brightnessSlider_icon);
      item.add_child(this._brightnessSlider[i]);

      return item;
    }

    _createTempratureSlider() {
      if (this._devices.length > 1) {
        for (let i = 0; i < this._devices.length; i++) {
          this._switchSubmenuitem[i].menu.addMenuItem(
            this._createSingleTempratureSlider(i)
          );
        }
      } else {
        this.menu.addMenuItem(this._createSingleTempratureSlider(0));
      }
    }

    _createSingleTempratureSlider(i) {
      // Create the temperature slider
      this._temperatureSlider[i] = new Slider.Slider(0);
      this._temperatureSlider[i].accessible_name = _("Temperature");
      let iconPath = `${Local.path}/icons/display-brightness-symbolic.svg`;
      let gicon = Gio.icon_new_for_string(`${iconPath}`); 
      let temperatureSlider_icon = new St.Icon({
        gicon: gicon,
        style_class: "popup-menu-icon",
      });
      let item = new PopupMenu.PopupBaseMenuItem({ activate: false });
      item.add(temperatureSlider_icon);
      item.add_child(this._temperatureSlider[i]);

      return item;
    }

    _createSettingsMenuItem() {
      const version = this._currentVersion();
      const local = ExtensionUtils.getCurrentExtension();
      this._settingsItem = new PopupMenu.PopupMenuItem(_("Settings"));
      this._settingsItem.connect("activate", () => {
        this._openPrefs(version, local.metadata.uuid, {
          shell: imports.gi.Shell,
        });
      });
      this.menu.addMenuItem(this._settingsItem);
    }

    _currentVersion() {
      return new Version(imports.misc.config.PACKAGE_VERSION);
    }

    _brightnessChanged(i) {
      this._elgatoKeyLight[i].update({
        brightness: (100 * this._brightnessSlider[i].value) | 0,
      });
    }

    _temperatureChanged(i) {
      const temperature =
        2900 + this._temperatureSlider[i].value * (7000 - 2900);
      this._elgatoKeyLight[i].update({
        temperature: (1000000 / temperature) | 0,
      });
    }

    _toggle(i) {
      this._elgatoKeyLight[i].update({
        on: this._switchmenuitem[i].state ? 1 : 0,
      });
    }

    _updateDevices() {
      try {
        this._devices = JSON.parse(Settings.get_string("elgato-devices"));
      } catch (err) {
        this._devices = [];
        Settings.set_string("elgato-devices", "[]");
      }

      this._devices = JSON.parse(Settings.get_string("elgato-devices"));

      this._refreshGui();
    }

    /**
     * This works for < 3.36
     */
    _openPrefsAppSystem(uuid, params = {}) {
      const shell = params.shell;
      if (!shell) {
        throw new Error("must provide shell");
      }
      const appSys = shell.AppSystem.get_default();
      const appId = "gnome-shell-extension-prefs.desktop";
      const prefs = appSys.lookup_app(appId);
      if (!prefs) {
        logError(new Error("could not find prefs app"));
        return;
      }
      if (prefs.get_state() == Shell.AppState.RUNNING) {
        prefs.activate();
      } else {
        prefs.get_app_info().launch_uris(["extension:///" + uuid], null);
      }
    }

    /**
     * Works for >= 3.36, maybe earlier
     */
    _openPrefsUtilSpawn(uuid) {
      const Util = imports.misc.util;
      Util.spawn(["gnome-extensions", "prefs", uuid]);
    }

    _openPrefs(version, uuid, params = {}) {
      if (version.greaterEqual("3.36")) {
        return this._openPrefsUtilSpawn(uuid);
      }
      return this._openPrefsAppSystem(uuid, params);
    }
  }
);

function versionArray(v) {
  return v.split(".").map(Number);
}
function zip(a, b, defaultValue) {
  if (a.length === 0 && b.length === 0) {
    return [];
  }
  const headA = a.length > 0 ? a.shift() : defaultValue;
  const headB = b.length > 0 ? b.shift() : defaultValue;
  return [[headA, headB]].concat(zip(a, b, defaultValue));
}
function versionEqual(a, b) {
  return zip(versionArray(a), versionArray(b), 0).reduce(
    (prev, [a, b]) => prev && a === b,
    true
  );
}
function versionGreater(a, b) {
  const diff = zip(versionArray(a), versionArray(b), 0).find(
    ([a, b]) => a !== b
  );
  if (!diff) {
    return false;
  }
  const [x, y] = diff;
  return x > y;
}
function versionSmaller(a, b) {
  return !versionEqual(a, b) && !versionGreater(a, b);
}

class Version {
  constructor(packageVersion) {
    this.packageVersion = packageVersion;
  }
  equal(v) {
    return versionEqual(this.packageVersion, v);
  }
  greater(v) {
    return versionGreater(this.packageVersion, v);
  }
  smaller(v) {
    return versionSmaller(this.packageVersion, v);
  }
  greaterEqual(v) {
    return this.equal(v) || this.greater(v);
  }
  smallerEqual(v) {
    return this.equal(v) || this.smaller(v);
  }
}

class Extension {
  constructor(uuid) {
    this._uuid = uuid;

    ExtensionUtils.initTranslations(GETTEXT_DOMAIN);
  }

  enable() {
    this._indicator = new ElgatoKeyLightButton();
    Main.panel.addToStatusArea(this._uuid, this._indicator);
  }

  disable() {
    this._indicator.destroy();
    this._indicator = null;
  }
}

function init(meta) {
  return new Extension(meta.uuid);
}
