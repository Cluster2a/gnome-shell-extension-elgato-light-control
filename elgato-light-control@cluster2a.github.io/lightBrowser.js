// Discovery of Elgato Key Lights on the local network via Avahi over D-Bus.
//
// This is a port of the reference implementation kindly contributed by
// Owen Taylor <otaylor@redhat.com> in
// https://github.com/Cluster2a/gnome-shell-extension-elgato-light-control/issues/2
// adapted to ESM and modern GJS. The original is distributed under the MIT
// license, Copyright 2021, Red Hat, Inc.; the mDNS corner-case handling below
// (re-lookup on record expiry, IPv4/IPv6 merging) is his work.

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';

// We hardcode the relevant parts of Avahi's D-Bus introspection here so we
// don't have to locate the XML on disk. This is a stable API.
const AvahiServerIface = `
<node>
  <interface name="org.freedesktop.Avahi.Server">
    <method name="ServiceBrowserNew">
      <arg name="interface" type="i" direction="in"/>
      <arg name="protocol" type="i" direction="in"/>
      <arg name="type" type="s" direction="in"/>
      <arg name="domain" type="s" direction="in"/>
      <arg name="flags" type="u" direction="in"/>
      <arg name="path" type="o" direction="out"/>
    </method>
    <method name="ResolveService">
      <arg name="interface" type="i" direction="in"/>
      <arg name="protocol" type="i" direction="in"/>
      <arg name="name" type="s" direction="in"/>
      <arg name="type" type="s" direction="in"/>
      <arg name="domain" type="s" direction="in"/>
      <arg name="aprotocol" type="i" direction="in"/>
      <arg name="flags" type="u" direction="in"/>
      <arg name="interface" type="i" direction="out"/>
      <arg name="protocol" type="i" direction="out"/>
      <arg name="name" type="s" direction="out"/>
      <arg name="type" type="s" direction="out"/>
      <arg name="domain" type="s" direction="out"/>
      <arg name="host" type="s" direction="out"/>
      <arg name="aprotocol" type="i" direction="out"/>
      <arg name="address" type="s" direction="out"/>
      <arg name="port" type="q" direction="out"/>
      <arg name="txt" type="aay" direction="out"/>
      <arg name="flags" type="u" direction="out"/>
    </method>
  </interface>
</node>`;

const AvahiServiceBrowserIface = `
<node>
  <interface name="org.freedesktop.Avahi.ServiceBrowser">
    <method name="Free"/>
    <signal name="ItemNew">
      <arg name="interface" type="i"/>
      <arg name="protocol" type="i"/>
      <arg name="name" type="s"/>
      <arg name="type" type="s"/>
      <arg name="domain" type="s"/>
      <arg name="flags" type="u"/>
    </signal>
    <signal name="ItemRemove">
      <arg name="interface" type="i"/>
      <arg name="protocol" type="i"/>
      <arg name="name" type="s"/>
      <arg name="type" type="s"/>
      <arg name="domain" type="s"/>
      <arg name="flags" type="u"/>
    </signal>
  </interface>
</node>`;

// Wait this long after the last change before emitting ::changed, so a burst
// of resolver results coalesces into a single menu rebuild (milliseconds).
const SETTLE_DELAY = 1000;

// Re-resolve each known light this often (seconds) to follow IP changes and to
// drop lights whose address records expired after they were powered off.
const RELOOKUP_SECONDS = 60;

const AVAHI_PROTO_INET = 0;
const AVAHI_PROTO_INET6 = 1;
const AVAHI_IF_UNSPEC = -1;
const AVAHI_PROTO_UNSPEC = -1;

// Resolution state of a browsed service entry.
const LOOKUP = 0;
const RESOLVED = 1;
const RESOLVED_RESCAN = 2;
const FAILED = 3;
const FAILED_RESCAN = 4;
const REMOVED = 5;

// One result of browsing for _elg._tcp records. We fill in the address fields
// once resolved, then merge IPv4/IPv6 entries with the same name into one light.
class ServiceEntry {
    constructor(iface, protocol, name, type, domain) {
        this.iface = iface;
        this.protocol = protocol;
        this.type = type;
        this.domain = domain;
        this.name = name;
        this.key = ServiceEntry.makeKey(iface, protocol, name);

        this.address = null;
        this.addressv6 = null;
        this.port = null;
        this.friendlyName = null;

        this.state = LOOKUP;
        this.lastResolved = 0;
    }

    static makeKey(iface, protocol, name) {
        return `${iface},${protocol},${name}`;
    }

    makeLight() {
        return {
            key: `${this.iface},${this.name}`,
            name: this.name,
            friendlyName: this.friendlyName,
            address: this.address,
            addressv6: this.addressv6,
            port: this.port,
        };
    }
}

/**
 * Watches for Elgato Key Lights on the local network using Avahi. Connect to
 * the 'changed' signal and read the 'lights' property when it fires.
 *
 * A tricky thing here is that Avahi obeys the TTL of reported records, and a
 * light advertises a long TTL on its _elg._tcp PTR record (~1h15m) but short
 * TTLs on its address records (~2m). After a light is powered off it sends no
 * mDNS "goodbye", so Avahi keeps reporting the PTR and we would never notice
 * the light going away or coming back. We therefore periodically re-resolve
 * known entries to pick up address changes and to drop lights once their
 * address records expire.
 *
 * IPv6 is handled by broadcasting over both protocols, asking IPv4 responders
 * for an A record and IPv6 responders for an AAAA record, and merging the two
 * views of one device. Prefer 'address' (IPv4) and fall back to 'addressv6'.
 *
 * Even so, a powered-off light is reported as present until its address records
 * time out, so consumers must tolerate a light in .lights being unreachable.
 */
export const ElgatoLightBrowser = GObject.registerClass({
    Signals: {
        'changed': {},
        'avahi-missing': {},
    },
}, class ElgatoLightBrowser extends GObject.Object {
    static _ServerProxy = Gio.DBusProxy.makeProxyWrapper(AvahiServerIface);
    static _ServiceBrowserProxy = Gio.DBusProxy.makeProxyWrapper(AvahiServiceBrowserIface);
    static _decoder = new TextDecoder();

    _init() {
        super._init();

        this.lights = [];
        this._serviceEntries = new Map();
        this._changedTimeout = null;
        this._relookupTimeout = null;
        this._browserProxy = null;

        this._serverProxy = new ElgatoLightBrowser._ServerProxy(
            Gio.DBus.system, 'org.freedesktop.Avahi', '/');
        this._startBrowser();
    }

    // Open a fresh Avahi service browser. Avahi replays its cached entries as
    // ItemNew signals, so this re-resolves every currently-advertised light.
    _startBrowser() {
        this._serverProxy.ServiceBrowserNewRemote(
            AVAHI_IF_UNSPEC, AVAHI_PROTO_UNSPEC, '_elg._tcp', '', 0,
            (result, error) => {
                if (error) {
                    if (error.matches(Gio.dbus_error_quark(), Gio.DBusError.SERVICE_UNKNOWN))
                        this.emit('avahi-missing');
                    else
                        console.warn(`Elgato: failed to create Avahi browser: ${error.message}`);
                    return;
                }

                const [path] = result;
                this._browserProxy = new ElgatoLightBrowser._ServiceBrowserProxy(
                    Gio.DBus.system, 'org.freedesktop.Avahi', path);
                this._itemNewId = this._browserProxy.connectSignal('ItemNew',
                    (proxy, sender, [iface, protocol, name, type, domain]) =>
                        this._onItemNew(iface, protocol, name, type, domain));
                this._itemRemoveId = this._browserProxy.connectSignal('ItemRemove',
                    (proxy, sender, [iface, protocol, name]) =>
                        this._onItemRemove(iface, protocol, name));
            });
    }

    _resolveServiceEntry(entry) {
        switch (entry.state) {
        case LOOKUP:
            break;
        case FAILED:
            entry.state = FAILED_RESCAN;
            break;
        case RESOLVED:
            entry.state = RESOLVED_RESCAN;
            break;
        default:
            return;
        }

        entry.lastResolved = GLib.get_monotonic_time();

        // Ask IPv4 responders for an IPv4 address, IPv6 responders for IPv6.
        const aprotocol = entry.protocol;
        this._serverProxy.ResolveServiceRemote(
            entry.iface, entry.protocol, entry.name, entry.type, entry.domain, aprotocol, 0,
            (result, error) => {
                if (this._browserProxy === null)
                    return; // shut down

                if (error) {
                    entry.state = FAILED;
                    this._setRelookupTimeout();
                    this._changed();
                    return;
                }

                if (entry.state === REMOVED)
                    return;

                const [, , , , , , , address, port, txt] = result;

                let friendlyName = null;
                for (const item of txt) {
                    const [key, value] = ElgatoLightBrowser._decoder.decode(item).split('=');
                    if (key === 'md')
                        friendlyName = value;
                }

                Object.assign(entry, {
                    state: RESOLVED,
                    address: entry.protocol === AVAHI_PROTO_INET ? address : null,
                    addressv6: entry.protocol === AVAHI_PROTO_INET6 ? address : null,
                    port,
                    friendlyName,
                });

                this._setRelookupTimeout();
                this._changed();
            });
    }

    _relookup() {
        const now = GLib.get_monotonic_time();
        for (const entry of this._serviceEntries.values()) {
            if (entry.lastResolved + RELOOKUP_SECONDS * 1000000 <= now)
                this._resolveServiceEntry(entry);
        }

        this._relookupTimeout = null;
        this._setRelookupTimeout();

        return GLib.SOURCE_REMOVE;
    }

    _removeRelookupTimeout() {
        if (this._relookupTimeout !== null) {
            GLib.source_remove(this._relookupTimeout);
            this._relookupTimeout = null;
        }
    }

    _setRelookupTimeout() {
        this._removeRelookupTimeout();

        const now = GLib.get_monotonic_time();
        let next = null;
        for (const entry of this._serviceEntries.values()) {
            if (entry.state === FAILED || entry.state === RESOLVED) {
                const entryNext = entry.lastResolved + RELOOKUP_SECONDS * 1000000;
                next = next === null ? entryNext : Math.min(next, entryNext);
            }
        }

        if (next !== null) {
            this._relookupTimeout = GLib.timeout_add(
                GLib.PRIORITY_DEFAULT, Math.floor(Math.max(0, next - now) / 1000),
                this._relookup.bind(this));
        }
    }

    _onItemNew(iface, protocol, name, type, domain) {
        const entry = new ServiceEntry(iface, protocol, name, type, domain);
        this._serviceEntries.set(entry.key, entry);
        this._resolveServiceEntry(entry);
    }

    _onItemRemove(iface, protocol, name) {
        const key = ServiceEntry.makeKey(iface, protocol, name);
        const entry = this._serviceEntries.get(key);
        if (!entry)
            return;

        entry.state = REMOVED;
        this._serviceEntries.delete(key);
        this._changed();
    }

    _changed() {
        // Merge resolved entries by device key, filling IPv4 gaps with IPv6.
        const merged = new Map();
        for (const entry of this._serviceEntries.values()) {
            if (entry.state !== RESOLVED && entry.state !== RESOLVED_RESCAN)
                continue;

            const newLight = entry.makeLight();
            const oldLight = merged.get(newLight.key);
            if (oldLight) {
                for (const [key, value] of Object.entries(oldLight)) {
                    if (value === null)
                        oldLight[key] = newLight[key];
                }
            } else {
                merged.set(newLight.key, newLight);
            }
        }

        const result = [...merged.values()];
        result.sort((a, b) => a.key.localeCompare(b.key));

        // Skip the signal if nothing actually changed.
        if (this.lights.length === result.length) {
            const changed = result.some((light, i) =>
                Object.entries(light).some(([key, value]) => this.lights[i][key] !== value));
            if (!changed)
                return;
        }

        this.lights = result;

        if (this._changedTimeout === null) {
            this._changedTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, SETTLE_DELAY, () => {
                this._changedTimeout = null;
                this.emit('changed');
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    // Forget everything seen so far and browse again from scratch. Lets the
    // user force an immediate scan (e.g. after powering a light on) rather than
    // waiting for the periodic re-resolve. Keeps signal connections intact, so
    // callers see results through the same 'changed' signal as before.
    restart() {
        this._teardownBrowser();
        this._serviceEntries.clear();
        this.lights = [];
        this._startBrowser();
    }

    // Frees the remote Avahi browser and all local timers, leaving the server
    // proxy in place so the browser can be started again.
    _teardownBrowser() {
        if (this._browserProxy) {
            this._browserProxy.FreeRemote();
            this._browserProxy.disconnectSignal(this._itemNewId);
            this._browserProxy.disconnectSignal(this._itemRemoveId);
            this._browserProxy = null;
        }
        this._removeRelookupTimeout();
        if (this._changedTimeout !== null) {
            GLib.source_remove(this._changedTimeout);
            this._changedTimeout = null;
        }
    }

    // Frees the remote Avahi browser and all local sources. Call once on disable.
    shutdown() {
        this._teardownBrowser();
        this._serverProxy = null;
    }
});
