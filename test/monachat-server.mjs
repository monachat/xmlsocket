import path from 'path';

import tripcode2ch from '2ch-trip';
import xml2js from 'xml2js';

import XMLSocket from '../lib/XMLSocket.mjs';

const tripcode = (password) =>
  password === '' ? 'jPpg5.obl6' : tripcode2ch(`#${password}`).slice(1);

const HOST = 'localhost';
const PORT = 9095;

const MAX_NUMBER_OF_ROOMS = 100;

const RECOGNIZED_ATTRIBUTES = {
  ENTER: [
    'r',
    'name',
    'trip',
    'id',
    'cmd',
    'param',
    'ihash',
    'pre',
    'stat',
    'g',
    'type',
    'b',
    'y',
    'x',
    'scl',
  ],
  SET: ['x', 'scl', 'stat', 'cmd', 'pre', 'param', 'id', 'y'],
  RSET: ['cmd', 'param', 'id'],
  COM: ['cmt', 'cnt', 'style', 'id'],
  IG: ['ihash', 'stat', 'id'],
};

const loggedIDs = {};
const freeIDs = [];
let maxID = 0;

const userCounts = {};
const userSockets = {};
const userAttributes = {};

// eslint-disable-next-line no-new
new XMLSocket.SocketPolicyFileServer(
  {
    host: HOST,
  },
  '<cross-domain-policy><allow-access-from domain="monachat.dyndns.org" to-ports="843,9090-9100" /><allow-access-from domain="monachat.net" to-ports="843,9090-9100" /><allow-access-from domain="chat.moja.jp" to-ports="843,9090-9100" /><allow-access-from domain="cool.moja.jp" to-ports="843,9090-9100" /></cross-domain-policy>',
);

// eslint-disable-next-line no-new
new XMLSocket.Server(
  {
    host: HOST,
    port: PORT,
  },
  (client) => {
    let clientID;

    let roomPath;
    let parentRoomPath;
    let roomName;

    const send = (message, socket = client) => {
      socket.write(`${message}\0`);
    };

    const sendToRoomUsers = (message, sockets = userSockets[roomPath]) => {
      if (!sockets) {
        return;
      }

      Object.values(sockets).forEach((socket) => {
        send(message, socket);
      });
    };

    const onExit = () => {
      userCounts[roomPath] -= 1;
      delete userAttributes[roomPath][clientID];
      delete userSockets[roomPath][clientID];

      sendToRoomUsers(`<EXIT id="${clientID}" />`);

      sendToRoomUsers(`<COUNT c="${userCounts[roomPath]}" n="${roomName}" />`);

      if (userSockets[parentRoomPath]) {
        sendToRoomUsers(
          `<COUNT><ROOM c="${userCounts[roomPath]}" n="${roomName}" /></COUNT>`,
          userSockets[parentRoomPath],
        );
      }

      roomPath = undefined;
      parentRoomPath = undefined;
      roomName = undefined;
    };

    const onEnd = () => {
      if (clientID) {
        freeIDs.unshift(clientID);
        delete loggedIDs[clientID];

        if (roomPath != null) {
          onExit();
        }
      }
    };

    client.on('data', (bytes) => {
      const string = String(bytes);

      if (!string.endsWith('\0')) {
        client.destroy();
        return;
      }

      const lines = string.replace(/\0$/, '').split('\0');
      console.log(lines);

      class StopIteration extends Error {}

      try {
        lines.forEach((line) => {
          if (line === 'MojaChat') {
            if (freeIDs.length) {
              clientID = freeIDs.pop();
            } else {
              maxID += 1;
              clientID = maxID;
            }

            loggedIDs[clientID] = (loggedIDs[clientID] || 0) + 1;

            send(`+connect id=${clientID}`);
            send(`<CONNECT id="${clientID}" />`);

            return;
          }

          if (!clientID) {
            client.destroy();
            throw new StopIteration();
          }

          xml2js.parseString(line, (error, object) => {
            if (error || !object) {
              client.destroy();
              throw new StopIteration();
            }

            const rootTagName = Object.keys(object)[0];
            const attributes = object[rootTagName].$ || {};

            switch (rootTagName) {
              case 'policy-file-request': {
                return;
              }
              case 'NOP': {
                return;
              }
              case 'ENTER': {
                roomPath = path.resolve('/', attributes.room || '');
                parentRoomPath = path.dirname(roomPath);
                roomName = path.basename(roomPath);

                const umax = Number(attributes.umax);

                if (
                  umax &&
                  userCounts[roomPath] &&
                  userCounts[roomPath] >= umax
                ) {
                  send('<FULL />');

                  roomPath = undefined;
                  parentRoomPath = undefined;
                  roomName = undefined;

                  return;
                }

                userCounts[roomPath] = (userCounts[roomPath] || 0) + 1;

                userSockets[roomPath] = userSockets[roomPath] || {};
                userSockets[roomPath][clientID] = client;

                userAttributes[roomPath] = userAttributes[roomPath] || {};

                if (Object.entries(userAttributes[roomPath]).length) {
                  send(
                    `<ROOM>${Object.values(userAttributes[roomPath])
                      .map(
                        (value) =>
                          `<USER${[
                            'r',
                            'name',
                            'id',
                            'trip',
                            'ihash',
                            'stat',
                            'g',
                            'type',
                            'b',
                            'y',
                            'x',
                            'scl',
                          ]
                            .map((name) =>
                              value[name] ? ` ${name}="${value[name]}"` : '',
                            )
                            .join('')} />`,
                      )
                      .join('')}</ROOM>`,
                  );
                } else {
                  send('<ROOM />');
                }

                userAttributes[roomPath][clientID] = attributes;

                userAttributes[roomPath][clientID].id = clientID;

                if ('trip' in attributes) {
                  userAttributes[roomPath][clientID].trip = tripcode(
                    attributes.trip,
                  );
                }

                userAttributes[roomPath][clientID].ihash = tripcode(
                  client.remoteAddress,
                );

                if (attributes.attrib === 'no') {
                  send(
                    `<UINFO${['name', 'trip', 'id']
                      .map((name) =>
                        attributes[name]
                          ? ` ${name}="${attributes[name]}"`
                          : '',
                      )
                      .join('')} />`,
                  );

                  const childRoomUserCounts = {};

                  Object.entries(userCounts).forEach(
                    ([childRoomPath, count]) => {
                      const matches = childRoomPath.match(
                        new RegExp(
                          `^${roomPath
                            .replace(/\/$/, '')
                            .replace(/(\W)/g, '\\$1')}/([^/]+)$`,
                        ),
                      );

                      if (!matches) return;

                      const childRoomName = matches[1];
                      childRoomUserCounts[childRoomName] = count;
                    },
                  );

                  if (Object.entries(childRoomUserCounts).length) {
                    send(
                      `<COUNT>${Object.entries(childRoomUserCounts)
                        .map(
                          ([childRoomName, count]) =>
                            `<ROOM c="${count}" n="${childRoomName}" />`,
                        )
                        .join('')}</COUNT>`,
                    );
                  }

                  sendToRoomUsers(`<ENTER id="${clientID}" />`);
                } else {
                  sendToRoomUsers(
                    `<ENTER${RECOGNIZED_ATTRIBUTES.ENTER.map((name) =>
                      attributes[name] ? ` ${name}="${attributes[name]}"` : '',
                    ).join('')} />`,
                  );
                }

                sendToRoomUsers(
                  `<COUNT c="${userCounts[roomPath]}" n="${roomName}" />`,
                );

                if (userSockets[parentRoomPath]) {
                  sendToRoomUsers(
                    `<COUNT><ROOM c="${userCounts[roomPath]}" n="${roomName}" /></COUNT>`,
                    userSockets[parentRoomPath],
                  );
                }

                return;
              }
              case 'EXIT': {
                if (roomPath == null) {
                  return;
                }

                send(`<EXIT id="${clientID}" />`);

                onExit();

                return;
              }
              default: {
                if (!RECOGNIZED_ATTRIBUTES[rootTagName]) {
                  client.destroy();
                  throw new StopIteration();
                }

                if (rootTagName === 'SET') {
                  Object.assign(userAttributes[roomPath][clientID], attributes);
                }

                sendToRoomUsers(
                  `<${rootTagName}${RECOGNIZED_ATTRIBUTES[rootTagName]
                    .map((name) =>
                      name === 'id'
                        ? ` id="${clientID}"`
                        : attributes[name]
                        ? ` ${name}="${attributes[name]}"`
                        : '',
                    )
                    .join('')} />`,
                );
              }
            }
          });
        });
      } catch (error) {
        if (!(error instanceof StopIteration)) {
          throw error;
        }

        onEnd();
      }
    });

    client.on('end', onEnd);

    client.on('error', onEnd);
  },
);
