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

const { Gio, GLib } = imports.gi;
const ByteArray = imports.byteArray;
const Gettext = imports.gettext;

const NOTIFY_PATH = GLib.find_program_in_path("notify-send");
const GJS_PATH = GLib.find_program_in_path("gjs");

let launcher;
let runApp;

function getSettings(localPath, schemaName) {
  if (!localPath) return null;

  schemaName = schemaName || "org.gnome.shell.extensions.elgato-light-control";

  const GioSSS = Gio.SettingsSchemaSource;
  let schemaDir = Gio.File.new_for_path(localPath).get_child("schemas");
  let schemaSource = null;

  if (schemaDir.query_exists(null)) {
    schemaSource = GioSSS.new_from_directory(
      localPath + "/schemas",
      GioSSS.get_default(),
      false
    );
    printerr("1");
    printerr(localPath + "/schemas", GioSSS.get_default());
  } else {
    schemaSource = GioSSS.get_default();
    printerr("2");
    printerr(GioSSS.get_default());
  }

  let schemaObj = schemaSource.lookup(schemaName, true);
  if (!schemaObj)
    throw new Error(
      "Elgato light control: extension schemas could not be found!"
    );

  return new Gio.Settings({ settings_schema: schemaObj });
}

function initTranslations(localPath, gettextDomain) {
  gettextDomain = gettextDomain || "elgato-light-control";

  if (localPath) {
    let localeDir = Gio.File.new_for_path(localPath).get_child("locale");

    if (localeDir.query_exists(null))
      Gettext.bindtextdomain(gettextDomain, localPath + "/locale");
    else Gettext.bindtextdomain(gettextDomain, "/usr/share/locale");
  }
}
