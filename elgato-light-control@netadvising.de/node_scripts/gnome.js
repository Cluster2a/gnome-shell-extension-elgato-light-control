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

const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const debug = require("debug")("gnome");
const noop = () => {};

var schemaName = "org.gnome.shell.extensions.elgato-light-control";
var schemaDir = path.join(__dirname + "/../schemas");
var isSchema = false;

module.exports = {
  isRemote: false,
  isLockScreen: false,

  loadSchema: function (customName, customPath) {
    schemaName = customName || schemaName;
    schemaDir = customPath || schemaDir;

    isSchema = fs.existsSync(`${schemaDir}/gschemas.compiled`);
    debug(`Settings schema available: ${isSchema}`);
  },

  setSetting: function (setting, value, cb) {
    cb = cb || noop;

    var args = ["set", schemaName, setting, value];
    if (isSchema) args.unshift("--schemadir", schemaDir);

    debug(`Set ${setting}: ${value}`);
    var gProcess = spawn("gsettings", args);
    gProcess.once("exit", cb);
  },

  getSetting: function (setting) {
    var args = ["get", schemaName, setting];
    if (isSchema) args.unshift("--schemadir", schemaDir);

    var gsettings = spawnSync("gsettings", args);
    var value = String(gsettings.stdout).replace(/\n/, "").replace(/\'/g, "");
    debug(`Get ${setting}: ${value}`);

    return value;
  },

  getBoolean: function (setting) {
    var value = this.getSetting(setting);
    return value === "true" || value === true;
  },

  getJSON: function (setting) {
    var value = this.getSetting(setting);
    return JSON.parse(value);
  },
};
