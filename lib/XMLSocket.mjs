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
