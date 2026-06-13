// Preferences:
//   * rename or identify the lights the shell has discovered (the shell
//     publishes them to the 'discovered-lights' setting; this window does not
//     browse the network itself),
//   * ask the shell to rescan the network ('rediscover-trigger'),
//   * choose a keyboard shortcut that toggles every light ('toggle-shortcut').

import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {KeyLight} from './keyLight.js';

// How long to present a rescan as in progress before settling on whatever was
// found. Discovery is continuous, so this is purely cosmetic (seconds).
const SCAN_WINDOW_SECONDS = 8;

// How long a "saved" checkmark lingers after a successful rename (seconds).
const SAVED_BADGE_SECONDS = 2;

export default class ElgatoLightControlPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const page = new Adw.PreferencesPage();
        window.add(page);

        this._fillDiscovered(page, settings);
        this._fillShortcut(window, page, settings);
    }

    // A row per light the shell has discovered: rename it (persisted on the
    // device) or flash it to find which physical light it is.
    _fillDiscovered(page, settings) {
        const group = new Adw.PreferencesGroup({
            title: _('Lights'),
            description: _('Discovered automatically on your network. Rename a light to ' +
                'store a friendly name on the device, or identify it to make it flash.'),
        });
        page.add(group);

        // Ask the shell to rescan the network. We only bump the value; the
        // change notification is what the extension reacts to.
        const rediscover = new Gtk.Button({
            icon_name: 'view-refresh-symbolic',
            tooltip_text: _('Rediscover lights'),
            valign: Gtk.Align.CENTER,
            css_classes: ['flat'],
        });
        group.set_header_suffix(rediscover);

        let rows = [];
        let lights = [];
        let scanning = false;
        let scanTimeout = null;
        let savedBadges = [];   // pending "saved" checkmark timeouts to clean up

        const placeholder = new Adw.ActionRow({
            title: _('No lights discovered yet'),
            subtitle: _('Make sure the extension is enabled and a light is powered on.'),
        });

        const searchSpinner = new Gtk.Spinner({
            valign: Gtk.Align.CENTER,
            spinning: true,
            width_request: 24,
            height_request: 24,
        });
        const searching = new Adw.ActionRow({
            title: _('Searching for lights…'),
            subtitle: _('Looking for Key Lights on your network.'),
        });
        searching.add_suffix(searchSpinner);

        const stopScan = () => {
            scanning = false;
            if (scanTimeout !== null) {
                GLib.source_remove(scanTimeout);
                scanTimeout = null;
            }
        };

        const rebuild = () => {
            for (const id of savedBadges)
                GLib.source_remove(id);
            savedBadges = [];
            for (const row of rows)
                group.remove(row);
            rows = [];
            for (const light of lights)
                light.destroy();
            lights = [];

            const entries = settings.get_strv('discovered-lights');
            if (entries.length === 0) {
                const empty = scanning ? searching : placeholder;
                group.add(empty);
                rows.push(empty);
                return;
            }

            for (const entry of entries) {
                const parts = entry.split('|');
                const address = parts[0];
                const port = Number.parseInt(parts[1], 10) || 9123;
                const model = parts.slice(2).join('|') || address;
                const keyLight = new KeyLight(address, port);
                lights.push(keyLight);

                const row = new Adw.EntryRow({
                    title: _('Name'),
                    show_apply_button: true,
                });

                // Feedback for the rename round-trip: a spinner while the PUT is
                // in flight, then a checkmark on success or an error icon (saving
                // hits the device over the network, so it can fail or hang).
                const saveSpinner = new Gtk.Spinner({
                    valign: Gtk.Align.CENTER,
                    visible: false,
                    spinning: true,
                    width_request: 16,
                    height_request: 16,
                });
                const saveStatus = new Gtk.Image({valign: Gtk.Align.CENTER, visible: false});
                row.add_suffix(saveSpinner);
                row.add_suffix(saveStatus);

                row.connect('apply', () => {
                    saveStatus.visible = false;
                    saveSpinner.visible = true;
                    keyLight.setDisplayName(row.text.trim())
                        .then(() => {
                            saveSpinner.visible = false;
                            saveStatus.icon_name = 'object-select-symbolic';
                            saveStatus.remove_css_class('error');
                            saveStatus.add_css_class('success');
                            saveStatus.tooltip_text = _('Saved');
                            saveStatus.visible = true;
                            const id = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT,
                                SAVED_BADGE_SECONDS, () => {
                                    saveStatus.visible = false;
                                    savedBadges = savedBadges.filter(x => x !== id);
                                    return GLib.SOURCE_REMOVE;
                                });
                            savedBadges.push(id);
                        })
                        .catch(e => {
                            saveSpinner.visible = false;
                            saveStatus.icon_name = 'dialog-error-symbolic';
                            saveStatus.remove_css_class('success');
                            saveStatus.add_css_class('error');
                            saveStatus.tooltip_text = _('Could not save the name to the light');
                            saveStatus.visible = true;
                            logError(e, 'Elgato: rename failed');
                        });
                });

                // Prefill with the name currently stored on the device.
                keyLight.getInfo()
                    .then(info => {
                        row.text = info?.displayName ?? '';
                    })
                    .catch(() => {});

                const identify = new Gtk.Button({
                    icon_name: 'view-reveal-symbolic',
                    tooltip_text: `${_('Identify')} — ${model}`,
                    valign: Gtk.Align.CENTER,
                    css_classes: ['flat'],
                });
                identify.connect('clicked', () =>
                    keyLight.identify().catch(e => logError(e, 'Elgato: identify failed')));
                row.add_suffix(identify);

                group.add(row);
                rows.push(row);
            }
        };

        // Ask the shell for a fresh scan and present it as in progress until the
        // results settle (or the window closes).
        const startScan = () => {
            scanning = true;
            if (scanTimeout !== null)
                GLib.source_remove(scanTimeout);
            scanTimeout = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT,
                SCAN_WINDOW_SECONDS, () => {
                    scanTimeout = null;
                    stopScan();
                    rebuild();
                    return GLib.SOURCE_REMOVE;
                });
            settings.set_int('rediscover-trigger', settings.get_int('rediscover-trigger') + 1);
            rebuild();
        };
        rediscover.connect('clicked', startScan);

        const changedId = settings.connect('changed::discovered-lights', rebuild);
        group.connect('destroy', () => {
            settings.disconnect(changedId);
            if (scanTimeout !== null)
                GLib.source_remove(scanTimeout);
            for (const id of savedBadges)
                GLib.source_remove(id);
            for (const light of lights)
                light.destroy();
        });

        // Show whatever the shell already published; if it's empty, kick off a
        // scan so the user sees the spinner instead of a bare "nothing here".
        if (settings.get_strv('discovered-lights').length === 0)
            startScan();
        else
            rebuild();
    }

    // A single row showing the current "toggle all lights" accelerator with a
    // button to capture a new one (Esc cancels, Backspace clears) and a button
    // to remove the current binding.
    _fillShortcut(window, page, settings) {
        const group = new Adw.PreferencesGroup({title: _('Keyboard shortcut')});
        page.add(group);

        const row = new Adw.ActionRow({
            title: _('Toggle all lights'),
            subtitle: _('Turns every known light on or off.'),
        });
        group.add(row);

        const shortcutLabel = new Gtk.ShortcutLabel({
            disabled_text: _('Disabled'),
            valign: Gtk.Align.CENTER,
        });
        row.add_suffix(shortcutLabel);

        const setButton = new Gtk.Button({
            label: _('Set'),
            valign: Gtk.Align.CENTER,
        });
        row.add_suffix(setButton);
        row.activatable_widget = setButton;

        // Clearing the binding here is more discoverable than knowing to press
        // Backspace while capturing. Only sensitive when a shortcut is set.
        const clearButton = new Gtk.Button({
            icon_name: 'user-trash-symbolic',
            tooltip_text: _('Remove shortcut'),
            valign: Gtk.Align.CENTER,
            css_classes: ['flat'],
        });
        clearButton.connect('clicked', () => settings.set_strv('toggle-shortcut', []));
        row.add_suffix(clearButton);

        const sync = () => {
            const [accel] = settings.get_strv('toggle-shortcut');
            shortcutLabel.accelerator = accel ?? '';
            clearButton.sensitive = !!accel;
        };

        setButton.connect('clicked', () => {
            setButton.sensitive = false;
            setButton.label = _('Press a key…');

            const controller = new Gtk.EventControllerKey();
            window.add_controller(controller);

            const finish = accel => {
                window.remove_controller(controller);
                setButton.sensitive = true;
                setButton.label = _('Set');
                if (accel !== null)
                    settings.set_strv('toggle-shortcut', accel ? [accel] : []);
            };

            controller.connect('key-pressed', (_c, keyval, keycode, state) => {
                const mask = state & Gtk.accelerator_get_default_mod_mask();
                if (keyval === Gdk.KEY_Escape && mask === 0) {
                    finish(null);   // cancel, keep current binding
                    return Gdk.EVENT_STOP;
                }
                if (keyval === Gdk.KEY_BackSpace && mask === 0) {
                    finish('');     // clear the binding
                    return Gdk.EVENT_STOP;
                }
                // Require a modifier so we don't capture a bare letter.
                if (mask === 0 || Gtk.accelerator_valid(keyval, mask) === false)
                    return Gdk.EVENT_STOP;

                finish(Gtk.accelerator_name_with_keycode(
                    Gdk.Display.get_default(), keyval, keycode, mask));
                return Gdk.EVENT_STOP;
            });
        });

        const changedId = settings.connect('changed::toggle-shortcut', sync);
        group.connect('destroy', () => settings.disconnect(changedId));
        sync();
    }
}
