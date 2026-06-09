// Preferences: manage lights added by hand for networks where mDNS discovery
// is unavailable. Everything is stored in the 'manual-lights' setting.

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class ElgatoLightControlPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage();
        window.add(page);

        const group = new Adw.PreferencesGroup({
            title: _('Manually added lights'),
            description: _('Lights are normally discovered automatically. Add one here by ' +
                'IP address (optionally ip:port, default 9123) if your network blocks mDNS.'),
        });
        page.add(group);

        const addButton = new Gtk.Button({
            icon_name: 'list-add-symbolic',
            valign: Gtk.Align.CENTER,
            css_classes: ['flat'],
        });
        addButton.connect('clicked', () =>
            settings.set_strv('manual-lights', [...settings.get_strv('manual-lights'), '']));
        group.set_header_suffix(addButton);

        let rows = [];
        const rebuild = () => {
            for (const row of rows)
                group.remove(row);
            rows = [];

            settings.get_strv('manual-lights').forEach((entry, index) => {
                const row = new Adw.EntryRow({
                    title: _('IP address'),
                    text: entry,
                    show_apply_button: true,
                });
                row.connect('apply', () => {
                    const lights = settings.get_strv('manual-lights');
                    lights[index] = row.text.trim();
                    settings.set_strv('manual-lights', lights);
                });

                const remove = new Gtk.Button({
                    icon_name: 'user-trash-symbolic',
                    valign: Gtk.Align.CENTER,
                    css_classes: ['flat'],
                });
                remove.connect('clicked', () => {
                    const lights = settings.get_strv('manual-lights');
                    lights.splice(index, 1);
                    settings.set_strv('manual-lights', lights);
                });
                row.add_suffix(remove);

                group.add(row);
                rows.push(row);
            });
        };

        const changedId = settings.connect('changed::manual-lights', rebuild);
        window.connect('destroy', () => settings.disconnect(changedId));
        rebuild();
    }
}
