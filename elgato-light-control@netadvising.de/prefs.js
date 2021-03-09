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

const { Gio, Gtk, GLib, Gdk, Vte, Pango, GObject } = imports.gi;
const Config = imports.misc.config;
const Local = imports.misc.extensionUtils.getCurrentExtension();
const { SettingLabel, addToGrid } = Local.imports.prefs_shared;
const Helper = Local.imports.helper;
const Settings = Helper.getSettings(Local.path);
const Gettext = imports.gettext.domain(
  "gnome-shell-extension-elgatolightcontrol"
);
const _ = Gettext.gettext;
const Convenience = Local.imports.convenience;
const HOME_DIR = GLib.get_home_dir();
const NODE_PATH =
  GLib.find_program_in_path("nodejs") || GLib.find_program_in_path("node");
const NPM_PATH = GLib.find_program_in_path("npm");

let ElgatoLightControlSettings = GObject.registerClass(
  class ElgatoLightControlSettings extends Gtk.VBox {
    _init() {
      super._init();

      this.notebook = new CastNotebook();
      this.pack_start(this.notebook, true, true, 0);
    }

    destroy() {
      super.destroy();
    }
  }
);

let CastNotebook = GObject.registerClass(
  class CastNotebook extends Gtk.Notebook {
    _init() {
      super._init({ margin: 5 });

      this.delay = 0;

      this.mainWidget = new MainSettings();
      this.addToNotebook(this.mainWidget, _("Devices"));

      this.modulesWidget = new ModulesSettings();
      this.addToNotebook(this.modulesWidget, _("Installation"));
    }

    addToNotebook(widget, name) {
      this.delay += 10;

      GLib.timeout_add(GLib.PRIORITY_DEFAULT, this.delay, () => {
        let label = new Gtk.Label({ label: _(name) });
        this.append_page(widget, label);

        if (!widget.visible && !widget.get_realized()) widget.realize();

        widget.show_all();

        return GLib.SOURCE_REMOVE;
      });
    }

    destroy() {
      this.mainWidget.destroy();
      this.modulesWidget.destroy();
      super.destroy();
    }
  }
);

let ModulesSettings = GObject.registerClass(
  class ModulesSettings extends Gtk.VBox {
    _init() {
      super._init({ margin: 10 });

      let installLabel = _("Install npm modules");
      this.installButton = new Gtk.Button({
        label: _(installLabel),
        expand: false,
        halign: Gtk.Align.CENTER,
      });

      let installCallback = () => {
        this.installButton.label = _(installLabel);
        this.installButton.set_sensitive(true);
      };

      let ptyCallback = (pty, spawnRes) => {
        let [res, pid] = pty.spawn_finish(spawnRes);
        this.termWidget.watch_child(pid);
      };

      let installModules = () => {
        if (!this.termWidget) return;

        this.termWidget.reset(true, true);
        /* Stops both server and monitor service */
        GLib.spawn_command_line_sync("pkill -SIGINT -f " + Local.path);
        this.installButton.set_sensitive(false);
        this.installButton.label = _("Installing...");

        let pty = Vte.Pty.new_sync(Vte.PtyFlags.DEFAULT, null);
        this.termWidget.set_pty(pty);

        try {
          pty.spawn_async(
            Local.path,
            [NPM_PATH, "install"],
            null,
            GLib.SpawnFlags.DO_NOT_REAP_CHILD,
            null,
            120000,
            null,
            (self, res) => ptyCallback(self, res)
          );
        } catch (err) {
          let errMsg = [
            "Error: Could not spawn VTE terminal",
            "Reason: " + err.message,
            "",
            "Try installing from terminal with:",
            "cd " + Local.path,
            "npm install",
            "\0",
          ].join("\n");

          this.termWidget.feed_child(errMsg, -1);

          this.installButton.label = _(installLabel);
          this.installButton.set_sensitive(true);
        }
      };

      /*
                    Creating new Vte.Terminal on prefs init causes weird misbehaviour
                    of prefs window. Adding it after small delay makes it work.
                */
      GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
        this.termWidget = new Vte.Terminal({
          scroll_on_output: true,
          margin_bottom: 10,
        });

        let background = new Gdk.RGBA({
          red: 0.96,
          green: 0.96,
          blue: 0.96,
          alpha: 1,
        });
        let foreground = new Gdk.RGBA({ red: 0, green: 0, blue: 0, alpha: 1 });

        this.termWidget.set_color_background(background);
        this.termWidget.set_color_foreground(foreground);
        this.termWidget.set_color_cursor(background);
        this.termWidget.set_cursor_shape(Vte.CursorShape.IBEAM);
        this.termWidget.set_cursor_blink_mode(Vte.CursorBlinkMode.OFF);
        this.termWidget.set_sensitive(false);

        this.installFinishSignal = this.termWidget.connect(
          "child-exited",
          installCallback.bind(this)
        );

        this.pack_start(this.termWidget, true, true, 0);
        this.pack_start(this.installButton, false, false, 0);
        this.show_all();

        return GLib.SOURCE_REMOVE;
      });

      this.installSignal = this.installButton.connect(
        "clicked",
        installModules.bind(this)
      );
    }

    destroy() {
      this.installButton.disconnect(this.installSignal);

      if (this.termWidget && this.installFinishSignal)
        this.termWidget.disconnect(this.installFinishSignal);

      super.destroy();
    }
  }
);

let MainSettings = GObject.registerClass(
  class MainSettings extends Gtk.VBox {
    _init() {
      super._init();

      let box = new Gtk.VBox({
        margin: 5,
        expand: true,
      });

      this.listStore = new Gtk.ListStore();
      this.listStore.set_column_types([
        GObject.TYPE_BOOLEAN,
        GObject.TYPE_STRING,
        GObject.TYPE_STRING,
        GObject.TYPE_STRING,
      ]);

      this.devices = [];
      this.devIndex = -1;
      this.loadStoreList();

      let treeView = new Gtk.TreeView({
        expand: true,
        enable_search: false,
        model: this.listStore,
      });

      let local = new Gtk.TreeViewColumn({ title: _("Auto") });
      let friendlyName = new Gtk.TreeViewColumn({
        title: _("Name"),
        min_width: 220,
      });
      let ip = new Gtk.TreeViewColumn({ title: "IP", min_width: 140 });
      let port = new Gtk.TreeViewColumn({ title: "Port", min_width: 50 });

      this.activeCell = new Gtk.CellRendererToggle({
        activatable: false,
      });

      this.ipAddressCell = new Gtk.CellRendererText({
        editable: true,
        placeholder_text: _("None"),
      });

      this.portCell = new Gtk.CellRendererText({
        editable: true,
        placeholder_text: "9129",
      });

      this.friendlyNameCell = new Gtk.CellRendererText({
        editable: true,
        weight: Pango.Weight.BOLD,
        /* TRANSLATORS: Text field temporary text */
        placeholder_text: _("Insert name"),
      });

      this.ipCellSignal = this.ipAddressCell.connect(
        "edited",
        this._onIPAddressCellEdit.bind(this)
      );
      this.portCellSignal = this.portCell.connect(
        "edited",
        this._onPortCellEdit.bind(this)
      );
      this.friendlyNameCellSignal = this.friendlyNameCell.connect(
        "edited",
        this._onFriendlyNameEdit.bind(this)
      );

      local.pack_start(this.activeCell, true);
      friendlyName.pack_start(this.friendlyNameCell, true);
      ip.pack_start(this.ipAddressCell, true);
      port.pack_start(this.portCell, true);

      local.add_attribute(this.activeCell, "active", 0);
      friendlyName.add_attribute(this.friendlyNameCell, "text", 1);
      ip.add_attribute(this.ipAddressCell, "text", 2);
      port.add_attribute(this.portCell, "text", 3);

      treeView.insert_column(local, 0);
      treeView.insert_column(friendlyName, 1);
      treeView.insert_column(ip, 2);
      treeView.insert_column(port, 3);

      box.pack_start(treeView, true, true, 0);

      this.treeSelection = treeView.get_selection();
      this.treeSelectionSignal = this.treeSelection.connect(
        "changed",
        this._onTreeSelectionChanged.bind(this)
      );

      let grid = new Gtk.Grid({
        valign: Gtk.Align.CENTER,
        halign: Gtk.Align.END,
        margin: 5,
        row_spacing: 6,
        column_spacing: 4,
      });

      this.scanButton = Gtk.Button.new_from_icon_name(
        "view-refresh-symbolic",
        4
      );
      this.addButton = Gtk.Button.new_from_icon_name("list-add-symbolic", 4);
      this.removeButton = Gtk.Button.new_from_icon_name(
        "list-remove-symbolic",
        4
      );

      this.syncIndicatorButton = new Gtk.Button({
        label: "Scanning...",
        valign: Gtk.Align.CENTER,
      });

      this.syncIndicatorButton.set_no_show_all(true);

      this.syncIndicatorButton.hide();

      grid.attach(this.syncIndicatorButton, 0, 0, 1, 1);
      grid.attach(this.scanButton, 1, 0, 1, 1);
      grid.attach(this.removeButton, 2, 0, 1, 1);
      grid.attach(this.addButton, 3, 0, 1, 1);

      this.addButtonSignal = this.addButton.connect(
        "clicked",
        this._onAddButtonClicked.bind(this)
      );
      this.removeButtonSignal = this.removeButton.connect(
        "clicked",
        this._onRemoveButtonClicked.bind(this)
      );

      this.scanSignal = this.scanButton.connect(
        "clicked",
        scanDevices.bind(this, this, this.scanButton, this.syncIndicatorButton)
      );

      grid.attach(this.scanButton, 0, 0, 1, 1);
      grid.attach(this.removeButton, 1, 0, 1, 1);
      grid.attach(this.addButton, 2, 0, 1, 1);
      box.pack_start(grid, false, false, 0);

      this.pack_start(box, true, true, 0);
      this.show();
    }

    loadStoreList() {
      /* Restore empty devices list if someone messed it externally */
      try {
        this.devices = JSON.parse(Settings.get_string("elgato-devices"));
      } catch (err) {
        this.devices = [];
        Settings.set_string("elgato-devices", "[]");
      }

      this.listStore.clear();

      this.devices.forEach((device) => {
        let devIp = device.ip || "";
        let isAuto =
          device.hasOwnProperty("name") && device.name.endsWith(".local");
        let devPort = device.port || "0";

        let iter = this.listStore.append();

        this.listStore.set(
          iter,
          [0, 1, 2, 3],
          [isAuto, device.friendlyName, devIp, devPort]
        );
      });
    }

    _onPortCellEdit(cell, path, newText) {
      newText = newText.trim();

      if (this.devices[path].port !== newText) {
        this.devices[path].port = newText;
        Settings.set_string("elgato-devices", JSON.stringify(this.devices));
        this.loadStoreList();
      }
    }

    _onIPAddressCellEdit(cell, path, newText) {
      newText = newText.trim();

      if (this.devices[path].ip !== newText) {
        this.devices[path].ip = newText;
        Settings.set_string("elgato-devices", JSON.stringify(this.devices));
        this.loadStoreList();
      }
    }

    _onFriendlyNameEdit(cell, path, newText) {
      newText = newText.trim();

      if (this.devices[path].friendlyName !== newText) {
        this.devices[path].name = newText;
        this.devices[path].friendlyName = newText;
        Settings.set_string("elgato-devices", JSON.stringify(this.devices));
        this.loadStoreList();
      }
    }

    _onTreeSelectionChanged() {
      let [isSelected, model, iter] = this.treeSelection.get_selected();
      this.devIndex = -1;

      if (isSelected) {
        this.devIndex = this.listStore.get_string_from_iter(iter);
        if (this.devIndex >= 0) {
          this.removeButton.set_sensitive(true);
          return;
        }
      }

      this.removeButton.set_sensitive(false);
    }

    _onTreeSelectionChanged() {
      let [isSelected, model, iter] = this.treeSelection.get_selected();
      this.devIndex = -1;

      if (isSelected) {
        this.devIndex = this.listStore.get_string_from_iter(iter);
        if (this.devIndex >= 0) {
          this.removeButton.set_sensitive(true);
          return;
        }
      }

      this.removeButton.set_sensitive(false);
    }

    _onAddButtonClicked() {
      this.devices.push({ name: "", friendlyName: "", ip: "" });
      Settings.set_string("elgato-devices", JSON.stringify(this.devices));
      this.loadStoreList();
    }

    _onRemoveButtonClicked() {
      if (this.devIndex >= 0) {
        this.devices.splice(this.devIndex, 1);
        Settings.set_string("elgato-devices", JSON.stringify(this.devices));
        this.loadStoreList();
      }
    }

    destroy() {
      super.destroy();
    }
  }
);

let MissingNotification = GObject.registerClass(
  class MissingNotification extends Gtk.VBox {
    _init(dependName) {
      super._init({
        height_request: 380,
        spacing: 10,
        margin: 20,
      });

      let label = null;

      label = new Gtk.Label({
        /* TRANSLATORS: Will contain dependency name at the beginning (e.g. Node.js is not installed) */
        label:
          '<span font="16"><b>' +
          dependName +
          " " +
          _("is not installed") +
          "</b></span>",
        use_markup: true,
        vexpand: true,
        valign: Gtk.Align.CENTER,
      });
      this.pack_start(label, true, true, 0);
      this.show_all();
    }
  }
);

function init() {}

function buildPrefsWidget_old() {
  const widget = new ElgatoKeyLightWidget();
  widget.w.show_all();

  return widget.w;
}

function buildPrefsWidget() {
  let widget = null;

  if (!NODE_PATH) return (widget = new MissingNotification("nodejs"));
  else if (!NPM_PATH) return (widget = new MissingNotification("npm"));

  nodeDir = NODE_PATH.substring(0, NODE_PATH.lastIndexOf("/"));
  nodeBin = NODE_PATH.substring(NODE_PATH.lastIndexOf("/") + 1);

  widget = new ElgatoLightControlSettings();
  widget.show_all();

  return widget;
}

function setDevices(caller) {
  let devices = [];

  /* Restore empty devices list if someone messed it externally */
  try {
    devices = JSON.parse(Settings.get_string("elgato-devices"));
  } catch (err) {
    Settings.set_string("elgato-devices", "[]");
  }

  caller.loadStoreList();
}

function scanDevices(caller, button, syncIndicator) {
  button.set_sensitive(false);
  syncIndicator.show();

  let [res, pid] = GLib.spawn_async(
    nodeDir,
    [nodeBin, Local.path + "/node_scripts/utils/scanner"],
    null,
    GLib.SpawnFlags.DO_NOT_REAP_CHILD,
    null
  );

  GLib.child_watch_add(GLib.PRIORITY_LOW, pid, () => {
    setDevices(caller);
    /* Set Automatic as active */
    button.set_sensitive(true);
    syncIndicator.hide();
  });
}
