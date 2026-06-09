// Elgato Light Control — a panel menu to control Elgato Key Lights that are
// discovered automatically on the local network (and optionally added by hand).

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Slider from 'resource:///org/gnome/shell/ui/slider.js';
import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {ElgatoLightBrowser} from './lightBrowser.js';
import {KeyLight} from './keyLight.js';

// The light reports colour temperature in mireds; these are its limits.
const MIRED_MIN = 143; // coolest (~7000K)
const MIRED_MAX = 344; // warmest (~2900K)

// Coalesce slider drags into one request this long after the last change (ms).
const WRITE_DELAY = 400;

const ElgatoIndicator = GObject.registerClass(
class ElgatoIndicator extends PanelMenu.Button {
    _init(extension) {
        super._init(0.0, _('Elgato Light Control'));

        this._extension = extension;
        this._settings = extension.getSettings();
        this._controls = [];
        this._pending = new Map();
        this._syncing = false;
        this._avahiMissing = false;
        this._discovered = false;

        this.add_child(new St.Icon({
            gicon: Gio.icon_new_for_string(`${extension.path}/icons/elgato-light-symbolic.svg`),
            style_class: 'system-status-icon',
        }));

        this._browser = new ElgatoLightBrowser();
        this._changedId = this._browser.connect('changed', () => {
            this._discovered = true;
            this._buildMenu();
        });
        this._avahiMissingId = this._browser.connect('avahi-missing', () => {
            this._avahiMissing = true;
            this._buildMenu();
        });

        this._settingsChangedId = this._settings.connect('changed::manual-lights',
            () => this._buildMenu());

        this._menuStateId = this.menu.connect('open-state-changed', (menu, open) => {
            if (open)
                this._refresh();
        });

        this._buildMenu();
    }

    // Merge auto-discovered lights with any manually configured ones.
    _collectLights() {
        const lights = new Map();

        for (const light of this._browser.lights) {
            const address = light.address || light.addressv6;
            if (!address)
                continue;
            lights.set(`${address}:${light.port}`, {
                label: light.friendlyName || light.name,
                address,
                port: light.port,
            });
        }

        for (const entry of this._settings.get_strv('manual-lights')) {
            const [address, portText] = entry.split(':');
            if (!address)
                continue;
            const port = Number.parseInt(portText, 10) || 9123;
            const key = `${address}:${port}`;
            if (!lights.has(key))
                lights.set(key, {label: address, address, port});
        }

        return [...lights.values()];
    }

    _buildMenu() {
        this._releaseControls();
        this.menu.removeAll();

        const lights = this._collectLights();

        if (this._avahiMissing) {
            this._addInfo(_('Avahi daemon is not available'));
        } else if (lights.length === 0) {
            this._addInfo(this._discovered
                ? _('No Key Lights found')
                : _('Searching for Key Lights…'));
        } else if (lights.length === 1) {
            this._addLightControls(this.menu, lights[0]);
        } else {
            for (const light of lights) {
                const section = new PopupMenu.PopupSubMenuMenuItem(light.label);
                this.menu.addMenuItem(section);
                this._addLightControls(section.menu, light);
            }
        }

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const settings = new PopupMenu.PopupMenuItem(_('Settings'));
        settings.connect('activate', () => this._extension.openPreferences());
        this.menu.addMenuItem(settings);
    }

    _addInfo(text) {
        const item = new PopupMenu.PopupMenuItem(text, {reactive: false});
        this.menu.addMenuItem(item);
    }

    _addLightControls(menu, light) {
        const keyLight = new KeyLight(light.address, light.port);
        const control = {keyLight, signals: []};

        control.power = new PopupMenu.PopupSwitchMenuItem(_('Power'), false);
        control.signals.push([control.power, control.power.connect('toggled', (item, state) =>
            this._write(`${light.address}:on`, () => keyLight.setState({on: state ? 1 : 0})))]);
        menu.addMenuItem(control.power);

        control.brightness = this._addSlider(menu, control.signals,
            'display-brightness-symbolic', _('Brightness'), value =>
                this._write(`${light.address}:bri`,
                    () => keyLight.setState({brightness: Math.round(value * 100)})));

        control.temperature = this._addSlider(menu, control.signals,
            'weather-clear-symbolic', _('Temperature'), value =>
                this._write(`${light.address}:temp`, () => keyLight.setState({
                    temperature: Math.round(MIRED_MIN + value * (MIRED_MAX - MIRED_MIN)),
                })));

        this._controls.push(control);
    }

    _addSlider(menu, signals, iconName, accessibleName, onChange) {
        const item = new PopupMenu.PopupBaseMenuItem({activate: false});
        item.add_child(new St.Icon({icon_name: iconName, style_class: 'popup-menu-icon'}));

        const slider = new Slider.Slider(0);
        slider.x_expand = true;
        slider.accessible_name = accessibleName;
        signals.push([slider, slider.connect('notify::value', () => {
            if (!this._syncing)
                onChange(slider.value);
        })]);
        item.add_child(slider);
        menu.addMenuItem(item);

        return slider;
    }

    _refresh() {
        for (const control of this._controls) {
            control.keyLight.getState().then(state => {
                this._syncing = true;
                control.power.setToggleState(state.on === 1);
                control.brightness.value = state.brightness / 100;
                control.temperature.value =
                    (state.temperature - MIRED_MIN) / (MIRED_MAX - MIRED_MIN);
                this._syncing = false;
            }).catch(() => {
                // Light is unreachable (e.g. powered off but still cached); ignore.
            });
        }
    }

    _write(key, action) {
        const existing = this._pending.get(key);
        if (existing)
            GLib.source_remove(existing);

        this._pending.set(key, GLib.timeout_add(GLib.PRIORITY_DEFAULT, WRITE_DELAY, () => {
            this._pending.delete(key);
            action().catch(e => console.warn(`Elgato: write failed: ${e.message}`));
            return GLib.SOURCE_REMOVE;
        }));
    }

    _releaseControls() {
        for (const id of this._pending.values())
            GLib.source_remove(id);
        this._pending.clear();

        for (const control of this._controls) {
            for (const [object, id] of control.signals)
                object.disconnect(id);
            control.keyLight.destroy();
        }
        this._controls = [];
    }

    destroy() {
        this._releaseControls();
        this.menu.disconnect(this._menuStateId);
        this._browser.disconnect(this._changedId);
        this._browser.disconnect(this._avahiMissingId);
        this._browser.shutdown();
        this._settings.disconnect(this._settingsChangedId);
        super.destroy();
    }
});

export default class ElgatoLightControlExtension extends Extension {
    enable() {
        this._indicator = new ElgatoIndicator(this);
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    disable() {
        this._indicator.destroy();
        this._indicator = null;
    }
}
