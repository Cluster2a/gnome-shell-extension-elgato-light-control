// Control of a single Elgato Key Light over its local HTTP API (libsoup 3).
//
// The light exposes /elgato/lights, returning and accepting
//   {"lights": [{"on": 0|1, "brightness": 0-100, "temperature": 143-344}]}
// where temperature is in mireds (143 ~ 7000K, 344 ~ 2900K). Partial updates
// are accepted, so we PUT only the fields we are changing.
//
// Two further endpoints are used for the convenience features:
//   GET/PUT /elgato/accessory-info  — device identity; displayName is writable
//     and persists on the hardware (shared with Elgato's own apps).
//   POST    /elgato/identify        — briefly flashes the light so you can tell
//     which physical light a menu entry refers to.

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup';

Gio._promisify(Soup.Session.prototype, 'send_and_read_async');

const decoder = new TextDecoder();
const encoder = new TextEncoder();

export class KeyLight {
    constructor(address, port) {
        // Bracket IPv6 literals for use in a URL.
        const host = address.includes(':') ? `[${address}]` : address;
        this._base = `http://${host}:${port}/elgato`;
        this._session = new Soup.Session();
    }

    // Sends a message and returns the parsed JSON body, or null if the response
    // had no body (e.g. the identify endpoint replies 200 with nothing).
    async _send(message) {
        const bytes = await this._session.send_and_read_async(
            message, GLib.PRIORITY_DEFAULT, null);
        if (message.get_status() !== Soup.Status.OK)
            throw new Error(`Elgato light returned HTTP ${message.get_status()}`);
        const data = bytes?.get_data();
        return data?.length ? JSON.parse(decoder.decode(data)) : null;
    }

    _put(uri, payload) {
        const message = Soup.Message.new('PUT', uri);
        const body = encoder.encode(JSON.stringify(payload));
        message.set_request_body_from_bytes('application/json', new GLib.Bytes(body));
        return this._send(message);
    }

    // Resolves to {on, brightness, temperature} for this light.
    async getState() {
        const body = await this._send(Soup.Message.new('GET', `${this._base}/lights`));
        return body.lights[0];
    }

    // Applies a partial update, e.g. {on: 1}, {brightness: 50}, {temperature: 200}.
    async setState(props) {
        await this._put(`${this._base}/lights`, {lights: [props]});
    }

    // Resolves to the accessory-info object (displayName, firmwareVersion, …).
    async getInfo() {
        return this._send(Soup.Message.new('GET', `${this._base}/accessory-info`));
    }

    // Persists a human-friendly name on the device itself. Partial PUT is fine.
    async setDisplayName(name) {
        await this._put(`${this._base}/accessory-info`, {displayName: name});
    }

    // Briefly flashes the light so the user can tell which one this is.
    async identify() {
        await this._send(Soup.Message.new('POST', `${this._base}/identify`));
    }

    destroy() {
        this._session.abort();
    }
}
