import net from 'net';

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
  constructor({ host, port }, onConnection) {
    this.socket = new net.Server(onConnection);
    /* (client) => {
      onConnection(client, (handlers) => {
        client.on('data', (data) => {
          const lines = String(data)
            .replace(/\0$/, '')
            .split('\0');

          lines.forEach((line) => {
            console.log(line);

            xml2js.parseString(line, (error, object) => {
              if (error) {
                const handler = handlers[line] || handlers.default;
                handler();
                return;
              }

              const rootTagName = Object.keys(object)[0];
              const attributes = object[rootTagName].$ || {};

              const handler = handlers[`<${rootTagName}>`] || handlers.default;
              handler(attributes, rootTagName);
            });
          });
        });
      });
    } */

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
    // eslint-disable-next-line constructor-super
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
