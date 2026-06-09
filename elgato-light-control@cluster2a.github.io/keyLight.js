// Control of a single Elgato Key Light over its local HTTP API (libsoup 3).
//
// The light exposes /elgato/lights, returning and accepting
//   {"lights": [{"on": 0|1, "brightness": 0-100, "temperature": 143-344}]}
// where temperature is in mireds (143 ~ 7000K, 344 ~ 2900K). Partial updates
// are accepted, so we PUT only the fields we are changing.

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
        this._uri = `http://${host}:${port}/elgato/lights`;
        this._session = new Soup.Session();
    }

    async _send(message) {
        const bytes = await this._session.send_and_read_async(
            message, GLib.PRIORITY_DEFAULT, null);
        if (message.get_status() !== Soup.Status.OK)
            throw new Error(`Elgato light returned HTTP ${message.get_status()}`);
        return JSON.parse(decoder.decode(bytes.get_data()));
    }

    // Resolves to {on, brightness, temperature} for this light.
    async getState() {
        const body = await this._send(Soup.Message.new('GET', this._uri));
        return body.lights[0];
    }

    // Applies a partial update, e.g. {on: 1}, {brightness: 50}, {temperature: 200}.
    async setState(props) {
        const message = Soup.Message.new('PUT', this._uri);
        const body = encoder.encode(JSON.stringify({lights: [props]}));
        message.set_request_body_from_bytes('application/json', new GLib.Bytes(body));
        await this._send(message);
    }

    destroy() {
        this._session.abort();
    }
}
