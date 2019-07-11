import path from 'path';

import tripcode2ch from '2ch-trip';

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

const socketPolicyFileServer = new XMLSocket.SocketPolicyFileServer(
  {
    host: HOST,
  },
  '<cross-domain-policy><allow-access-from domain="monachat.dyndns.org" to-ports="843,9090-9100" /><allow-access-from domain="monachat.net" to-ports="843,9090-9100" /><allow-access-from domain="chat.moja.jp" to-ports="843,9090-9100" /><allow-access-from domain="cool.moja.jp" to-ports="843,9090-9100" /></cross-domain-policy>',
);

const server = new XMLSocket.Server(
  {
    host: HOST,
    port: PORT,
  },
  (client, registerHandlers) => {
    let clientID;

    let roomPath;
    let parentRoomPath;
    let roomName;

    const sendToRoomUsers = (message, sockets = userSockets[roomPath]) => {
      Object.values(sockets).forEach((socket) => {
        socket.write(message);
      });
    };

    registerHandlers({
      MojaChat: () => {
        if (freeIDs.length) {
          clientID = freeIDs.pop();
        } else {
          maxID += 1;
          clientID = maxID;
        }

        loggedIDs[clientID] = (loggedIDs[clientID] || 0) + 1;

        client.write(`+connect id=${clientID}\0`);
        client.write(`<CONNECT id="${clientID}" />\0`);
      },
      '<policy-file-request>': () => {},
      '<NOP>': () => {},
      '<ENTER>': (attributes) => {
        roomPath = path.normalize(attributes.room);
        parentRoomPath = path.dirname(roomPath);
        roomName = path.basename(roomPath);

        const umax = Number(attributes.umax);

        if (umax && userCounts[roomPath] && userCounts[roomPath] >= umax) {
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

        userAttributes[roomPath][clientID] = attributes;

        userAttributes[roomPath][clientID].id = clientID;

        if ('trip' in attributes) {
          userAttributes[roomPath][clientID].trip = tripcode(attributes.trip);
        }

        userAttributes[roomPath][clientID].ihash = tripcode(
          client.remoteAddress,
        );

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
                .map(([number, count]) => `<ROOM c="${count}" n="${number}" />`)
                .join('')}</COUNT>\0`,
            );
          }

          sendToRoomUsers(`<ENTER id="${clientID}" />\0`);
        } else {
          sendToRoomUsers(
            `<ENTER${RECOGNIZED_ATTRIBUTES.ENTER.map((name) =>
              attributes[name] ? ` ${name}="${attributes[name]}"` : '',
            ).join('')} />\0`,
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
      },
      '<EXIT>': () => {
        if (!roomPath) {
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
      },
      default: (attributes, rootTagName) => {
        if (RECOGNIZED_ATTRIBUTES[rootTagName]) {
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
              .join('')} />\0`,
          );

          return;
        }

        client.destroy();
      },
    });

    client.on('end', () => {
      if (!clientID) return;

      freeIDs.unshift(clientID);
      delete loggedIDs[clientID];

      if (!roomPath) return;

      userCounts[roomPath] -= 1;
      delete userSockets[roomPath][clientID];
      delete userAttributes[roomPath][clientID];

      sendToRoomUsers(`<EXIT id="${clientID}" />\0`);

      sendToRoomUsers(
        `<COUNT c="${userCounts[roomPath]}" n="${roomName}" />\0`,
      );

      if (userSockets[parentRoomPath]) {
        sendToRoomUsers(
          `<COUNT><ROOM c="${userCounts[roomPath]}" n="${roomName}" /></COUNT>\0`,
          userSockets[parentRoomPath],
        );
      }

      roomPath = undefined;
      parentRoomPath = undefined;
      roomName = undefined;
    });
  },
);
