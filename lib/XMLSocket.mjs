import net from 'net';
import xml2js from 'xml2js';

export default class XMLSocket {
  constructor({ host, port }, onConnection) {
    this.socket = new net.Socket();

    this.socket.connect(port, host, onConnection);

    return new Proxy(this, {
      get: (...[, property]) => {
        if (property in this) {
          return this[property];
        }

        return this.socket[property];
      },
    });
  }
}

XMLSocket.Server = class {
  constructor({ host, port }, onConnection, xmlElementHandlers, onEnd) {
    this.socket = new net.Server((client) => {
      const socketID = Math.random();

      onConnection(client, socketID);

      if (xmlElementHandlers) {
        client.on('data', (data) => {
          const lines = String(data)
            .replace(/\0$/, '')
            .split('\0');

          lines.forEach((line) => {
            console.log(line);

            xml2js.parseString(line, (error, object) => {
              if (error) {
                const handler =
                  xmlElementHandlers[line] || xmlElementHandlers.default;

                handler(client, socketID);

                return;
              }

              const rootTagName = Object.keys(object)[0];
              const attributes = object[rootTagName].$ || {};

              const handler =
                xmlElementHandlers[`<${rootTagName}>`] ||
                xmlElementHandlers.default;

              handler(client, socketID, attributes, rootTagName);
            });
          });
        });
      }

      if (onEnd) {
        client.on('end', () => {
          onEnd(client, socketID);
        });
      }
    });

    this.socket.listen(port, host);

    return new Proxy(this, {
      get: (...[, property]) => {
        if (property in this) {
          return this[property];
        }

        return this.socket[property];
      },
    });
  }
};

XMLSocket.SocketPolicyFileServer = class extends XMLSocket.Server {
  constructor(options, policy) {
    return super(
      {
        port: 843,
        ...options,
      },
      (client) => {
        client.on('data', (data) => {
          if (String(data) === '<policy-file-request/>\0') {
            client.write(`${policy}\0`);
          }
        });
      },
    );
  }
};
