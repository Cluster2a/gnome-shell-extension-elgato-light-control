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

imports.gi.versions.Gtk = "3.0";

const { Gtk } = imports.gi;
let gridIndex = 0;

var SettingLabel = class SharedSettingLabel {
  constructor(text, isTitle, isTopMargin) {
    let label = null;
    let marginLR = 0;
    let marginTop = 0;

    if (isTitle) label = '<span font="12.5"><b>' + text + "</b></span>";
    else {
      label = text;
      marginLR = 12;
    }

    if (isTopMargin) marginTop = 20;

    return new Gtk.Label({
      label: label,
      use_markup: true,
      hexpand: true,
      halign: Gtk.Align.START,
      margin_top: marginTop,
      margin_left: marginLR,
      margin_right: marginLR,
    });
  }
};

function addToGrid(grid, leftWidget, rightWidget, resetIndex) {
  if (resetIndex) gridIndex = 0;
  if (leftWidget) grid.attach(leftWidget, 0, gridIndex, 1, 1);
  if (rightWidget) grid.attach(rightWidget, 1, gridIndex, 1, 1);

  gridIndex++;
}
