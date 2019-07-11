import path from 'path';

import tripcode2ch from '2ch-trip';
import xml2js from 'xml2js';

import XMLSocket from '../lib/XMLSocket.mjs';

const tripcode = (password) =>
  password === '' ? 'jPpg5.obl6' : tripcode2ch(`#${password}`).slice(1);

const HOST = 'localhost';
const PORT = 9095;

const NUMBER_OF_ROOMS = 100;

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

const socketPolicyFileServer = new XMLSocket.Server(
  {
    host: HOST,
    port: 843,
  },
  (client) => {
    client.on('data', (data) => {
      if (String(data) === '<policy-file-request/>\0') {
        client.write(
          '<cross-domain-policy><allow-access-from domain="monachat.dyndns.org" to-ports="843,9090-9100" /><allow-access-from domain="monachat.net" to-ports="843,9090-9100" /><allow-access-from domain="chat.moja.jp" to-ports="843,9090-9100" /><allow-access-from domain="cool.moja.jp" to-ports="843,9090-9100" /></cross-domain-policy>\0',
        );
      }
    });
  },
);

const server = new XMLSocket.Server(
  {
    host: HOST,
    port: PORT,
  },
  (client) => {
    let clientID;

    let roomPath;
    let parentRoomPath;
    let roomName;

    const sendToRoomUsers = (message, sockets = userSockets[roomPath]) => {
      Object.values(sockets).forEach((socket) => {
        socket.write(message);
      });
    };

    client.on('data', (data) => {
      const lines = String(data)
        .replace(/\0$/, '')
        .split('\0');

      lines.forEach((line) => {
        console.log(line);

        if (line === 'MojaChat') {
          if (freeIDs.length) {
            clientID = freeIDs.pop();
          } else {
            maxID += 1;
            clientID = maxID;
          }

          loggedIDs[clientID] = (loggedIDs[clientID] || 0) + 1;

          client.write(`+connect id=${clientID}\0`);
          client.write(`<CONNECT id="${clientID}" />\0`);

          return;
        }

        xml2js.parseString(line, (error, object) => {
          const root = Object.keys(object)[0];
          const attributes = object[root].$ || {};
          attributes.id = clientID;

          switch (root) {
            case 'policy-file-request': {
              return;
            }
            case 'NOP': {
              return;
            }
            case 'ENTER': {
              roomPath = path.normalize(attributes.room);
              parentRoomPath = path.dirname(roomPath);
              roomName = path.basename(roomPath);

              const umax = Number(attributes.umax);

              if (
                umax &&
                userCounts[roomPath] &&
                userCounts[roomPath] >= umax
              ) {
                client.write('<FULL />\0');
                return;
              }

              userCounts[roomPath] = (userCounts[roomPath] || 0) + 1;

              userSockets[roomPath] = userSockets[roomPath] || {};
              userSockets[roomPath][clientID] = client;

              userAttributes[roomPath] = userAttributes[roomPath] || {};

              if (Object.entries(userAttributes[roomPath]).length) {
                client.write(
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
                    .join('')}</ROOM>\0`,
                );
              } else {
                client.write('<ROOM />\0');
              }

              if ('trip' in attributes) {
                attributes.trip = tripcode(attributes.trip);
              }

              attributes.ihash = tripcode(client.remoteAddress);

              userAttributes[roomPath][clientID] = attributes;

              if (attributes.attrib === 'no') {
                client.write(
                  `<UINFO${['name', 'trip', 'id']
                    .map((name) =>
                      attributes[name] ? ` ${name}="${attributes[name]}"` : '',
                    )
                    .join('')} />\0`,
                );

                const childRoomUserCounts = {};

                for (let i = 1; i <= NUMBER_OF_ROOMS; i += 1) {
                  const childRoomPath = `${roomPath}/${i}`;

                  if (childRoomPath in userCounts) {
                    childRoomUserCounts[i] = userCounts[childRoomPath];
                  }
                }

                if (Object.entries(childRoomUserCounts).length) {
                  client.write(
                    `<COUNT>${Object.entries(childRoomUserCounts)
                      .map(
                        ([number, count]) =>
                          `<ROOM c="${count}" n="${number}" />`,
                      )
                      .join('')}</COUNT>\0`,
                  );
                }

                sendToRoomUsers(`<ENTER id="${clientID}" />\0`);
              } else {
                sendToRoomUsers(
                  `<ENTER${RECOGNIZED_ATTRIBUTES[root]
                    .map((name) =>
                      attributes[name] ? ` ${name}="${attributes[name]}"` : '',
                    )
                    .join('')} />\0`,
                );
              }

              sendToRoomUsers(
                `<COUNT c="${userCounts[roomPath]}" n="${roomName}" />\0`,
              );

              if (userSockets[parentRoomPath]) {
                sendToRoomUsers(
                  `<COUNT><ROOM c="${userCounts[roomPath]}" n="${roomName}" /></COUNT>\0`,
                  userSockets[parentRoomPath],
                );
              }

              return;
            }
            case 'EXIT': {
              if (roomPath == null) {
                client.write(`<EXIT id="${clientID}" />\0`);
                return;
              }

              userCounts[roomPath] -= 1;

              delete userAttributes[roomPath][clientID];

              sendToRoomUsers(`<EXIT id="${clientID}" />\0`);

              sendToRoomUsers(
                `<COUNT c="${userCounts[roomPath]}" n="${roomName}" />\0`,
              );

              delete userSockets[roomPath][clientID];

              if (userSockets[parentRoomPath]) {
                sendToRoomUsers(
                  `<COUNT><ROOM c="${userCounts[roomPath]}" n="${roomName}" /></COUNT>\0`,
                  userSockets[parentRoomPath],
                );
              }

              roomPath = undefined;
              parentRoomPath = undefined;
              roomName = undefined;

              return;
            }
            default: {
              if (RECOGNIZED_ATTRIBUTES[root]) {
                sendToRoomUsers(
                  `<${root}${RECOGNIZED_ATTRIBUTES[root]
                    .map((name) =>
                      attributes[name] ? ` ${name}="${attributes[name]}"` : '',
                    )
                    .join('')} />\0`,
                );

                if (root === 'SET') {
                  Object.assign(userAttributes[roomPath][clientID], attributes);
                }

                return;
              }

              client.destroy();
            }
          }
        });
      });
    });

    client.on('end', () => {
      if (clientID == null) return;

      freeIDs.unshift(clientID);
      delete loggedIDs[clientID];

      if (roomPath == null) return;

      userCounts[roomPath] -= 1;
      delete userSockets[roomPath][clientID];
      delete userAttributes[roomPath][clientID];

      sendToRoomUsers(`<EXIT id="${clientID}" />\0`);

      sendToRoomUsers(
        `<COUNT c="${userCounts[roomPath]}" n="${roomName}" />\0`,
      );

      if (userSockets[parentRoomPath]) {
        sendToRoomUsers(
          `<COUNT c="${userCounts[roomPath]}" n="${roomName}" />\0`,
          userSockets[parentRoomPath],
        );
      }

      roomPath = undefined;
      parentRoomPath = undefined;
      roomName = undefined;
    });
  },
);
