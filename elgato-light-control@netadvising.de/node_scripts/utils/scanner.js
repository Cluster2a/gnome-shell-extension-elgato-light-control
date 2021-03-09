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

var mdns = require("mdns-js");
mdns.excludeInterface("0.0.0.0");
const gnome = require("../gnome");
var TIMEOUT = 5000; //5 seconds

var browser = mdns.createBrowser(mdns.tcp("_elg"));

browser.on("ready", function () {
  browser.discover();
});

let devices = [];

browser.on("update", function (data) {
  let device = {
    name: data.fullname,
    friendlyName: data.txt[3].split("=")[1],
    ip: data.addresses[0],
    port: data.port.toString(),
  };

  devices.push(device);
});

//stop after timeout
setTimeout(function onTimeout() {
  browser.stop();
  gnome.loadSchema();
  gnome.setSetting("elgato-devices", JSON.stringify(devices));
}, TIMEOUT);
