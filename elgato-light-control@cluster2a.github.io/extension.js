// Elgato Light Control — a panel menu to control Elgato Key Lights that are
// discovered automatically on the local network.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
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
        this._browser.connectObject(
            'changed', () => {
                this._discovered = true;
                this._buildMenu();
            },
            'avahi-missing', () => {
                this._avahiMissing = true;
                this._buildMenu();
            },
            this);

        // The preferences window bumps this key to ask for a fresh scan.
        this._settings.connectObject('changed::rediscover-trigger',
            () => this._rediscover(), this);

        this.menu.connectObject('open-state-changed', (menu, open) => {
            if (open)
                this._refresh();
        }, this);

        this._buildMenu();
    }

    // Discovered lights as a de-duplicated list, one entry per address.
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

        return [...lights.values()];
    }

    // Restart discovery from scratch and show the searching state again. Driven
    // by the preferences window through the 'rediscover-trigger' setting.
    _rediscover() {
        this._discovered = false;
        this._avahiMissing = false;
        this._browser.restart();
        this._buildMenu();
    }

    _buildMenu() {
        this._releaseControls();
        this.menu.removeAll();
        this._allSwitch = null;

        this._publishDiscovered();

        const lights = this._collectLights();

        if (this._avahiMissing) {
            this._addInfo(_('Avahi daemon is not available'));
        } else if (lights.length === 0) {
            this._addInfo(this._discovered
                ? _('No Key Lights found')
                : _('Searching for Key Lights…'));
        } else if (lights.length === 1) {
            this._addLightControls(this.menu, lights[0], null);
        } else {
            // A master switch turns the whole set on or off at once.
            this._allSwitch = new PopupMenu.PopupSwitchMenuItem(_('All lights'), false);
            this._allSwitch.connectObject('toggled', (item, state) =>
                this._write('all:on', () => this._setAll({on: state ? 1 : 0})), this);
            this.menu.addMenuItem(this._allSwitch);
            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

            for (const light of lights) {
                const section = new PopupMenu.PopupSubMenuMenuItem(light.label);
                this.menu.addMenuItem(section);
                this._addLightControls(section.menu, light, section);
            }
        }

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const settings = new PopupMenu.PopupMenuItem(_('Settings'));
        settings.connect('activate', () => this._extension.openPreferences());
        this.menu.addMenuItem(settings);
    }

    // Mirror the discovered lights into settings so the preferences window —
    // which runs in a separate process and does not browse the network — can
    // offer to rename or identify them. Only write when something changed.
    _publishDiscovered() {
        const entries = [];
        for (const light of this._browser.lights) {
            const address = light.address || light.addressv6;
            if (!address)
                continue;
            entries.push(`${address}|${light.port}|${light.friendlyName || light.name || ''}`);
        }

        const current = this._settings.get_strv('discovered-lights');
        if (current.length !== entries.length ||
            current.some((value, i) => value !== entries[i]))
            this._settings.set_strv('discovered-lights', entries);
    }

    _addInfo(text) {
        const item = new PopupMenu.PopupMenuItem(text, {reactive: false});
        this.menu.addMenuItem(item);
    }

    _addLightControls(menu, light, section) {
        const keyLight = new KeyLight(light.address, light.port);
        const control = {keyLight};

        // Track these with connectObject(this); _releaseControls() drops them per
        // control object on every menu rebuild and on teardown.
        control.power = new PopupMenu.PopupSwitchMenuItem(_('Power'), false);
        control.power.connectObject('toggled', (item, state) =>
            this._write(`${light.address}:on`, () => keyLight.setState({on: state ? 1 : 0})), this);
        menu.addMenuItem(control.power);

        control.brightness = this._addSlider(menu,
            'display-brightness-symbolic', _('Brightness'), value =>
                this._write(`${light.address}:bri`,
                    () => keyLight.setState({brightness: Math.round(value * 100)})));

        control.temperature = this._addSlider(menu,
            'weather-clear-symbolic', _('Temperature'), value =>
                this._write(`${light.address}:temp`, () => keyLight.setState({
                    temperature: Math.round(MIRED_MIN + value * (MIRED_MAX - MIRED_MIN)),
                })));

        const identify = new PopupMenu.PopupImageMenuItem(_('Identify'), 'view-reveal-symbolic');
        identify.connectObject('activate', () =>
            keyLight.identify().catch(e => console.warn(`Elgato: identify failed: ${e.message}`)),
            this);
        menu.addMenuItem(identify);

        // If the device carries a custom name, prefer it over the mDNS model
        // name in the submenu heading. Best-effort; ignore if unreachable.
        if (section) {
            keyLight.getInfo().then(info => {
                if (info?.displayName)
                    section.label.text = info.displayName;
            }).catch(() => {});
        }

        this._controls.push(control);
    }

    _addSlider(menu, iconName, accessibleName, onChange) {
        const item = new PopupMenu.PopupBaseMenuItem({activate: false});
        item.add_child(new St.Icon({icon_name: iconName, style_class: 'popup-menu-icon'}));

        const slider = new Slider.Slider(0);
        slider.x_expand = true;
        slider.accessible_name = accessibleName;
        slider.connectObject('notify::value', () => {
            if (!this._syncing)
                onChange(slider.value);
        }, this);
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
                control.on = state.on === 1;
                this._syncAllSwitch();
            }).catch(() => {
                // Light is unreachable (e.g. powered off but still cached); ignore.
            });
        }
    }

    // The master switch reads as on when any reachable light is on.
    _syncAllSwitch() {
        if (!this._allSwitch)
            return;
        this._syncing = true;
        this._allSwitch.setToggleState(this._controls.some(c => c.on));
        this._syncing = false;
    }

    // Apply a partial update to every light at once; resolves when all are done.
    _setAll(props) {
        return Promise.all(this._controls.map(control =>
            control.keyLight.setState(props).catch(() => {})));
    }

    // Turn every known light off if any is currently on, otherwise on. Used by
    // the keyboard shortcut, so it works whether or not the menu is open.
    async toggleAll() {
        if (this._controls.length === 0)
            return;

        const states = await Promise.all(this._controls.map(control =>
            control.keyLight.getState().then(s => s.on === 1).catch(() => false)));
        const target = states.some(Boolean) ? 0 : 1;

        await this._setAll({on: target});
        this._refresh();
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
            control.power.disconnectObject(this);
            control.brightness.disconnectObject(this);
            control.temperature.disconnectObject(this);
            control.keyLight.destroy();
        }
        this._controls = [];
    }

    destroy() {
        this._releaseControls();
        this.menu.disconnectObject(this);
        this._browser.disconnectObject(this);
        this._browser.shutdown();
        this._settings.disconnectObject(this);
        super.destroy();
    }
});

export default class ElgatoLightControlExtension extends Extension {
    enable() {
        this._indicator = new ElgatoIndicator(this);
        Main.panel.addToStatusArea(this.uuid, this._indicator);

        // Global shortcut to toggle every light. The accelerator itself is
        // edited in preferences; rebinding there updates this live.
        Main.wm.addKeybinding('toggle-shortcut', this.getSettings(),
            Meta.KeyBindingFlags.NONE, Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
            () => this._indicator?.toggleAll());
    }

    disable() {
        Main.wm.removeKeybinding('toggle-shortcut');
        this._indicator.destroy();
        this._indicator = null;
    }
}
