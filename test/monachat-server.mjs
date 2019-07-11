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

const clientIDs = {};

const roomPaths = {};
const parentRoomPaths = {};
const roomNames = {};

const sendToRoomUsers = {};

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
  (client, socketID) => {
    sendToRoomUsers[socketID] = (
      message,
      sockets = userSockets[roomPaths[socketID]],
    ) => {
      Object.values(sockets).forEach((socket) => {
        socket.write(message);
      });
    };
  },
  {
    MojaChat: (client, socketID) => {
      if (freeIDs.length) {
        clientIDs[socketID] = freeIDs.pop();
      } else {
        maxID += 1;
        clientIDs[socketID] = maxID;
      }

      loggedIDs[clientIDs[socketID]] =
        (loggedIDs[clientIDs[socketID]] || 0) + 1;

      client.write(`+connect id=${clientIDs[socketID]}\0`);
      client.write(`<CONNECT id="${clientIDs[socketID]}" />\0`);
    },
    '<policy-file-request>': () => {},
    '<NOP>': () => {},
    '<ENTER>': (client, socketID, attributes) => {
      roomPaths[socketID] = path.normalize(attributes.room);
      parentRoomPaths[socketID] = path.dirname(roomPaths[socketID]);
      roomNames[socketID] = path.basename(roomPaths[socketID]);

      const umax = Number(attributes.umax);

      if (
        umax &&
        userCounts[roomPaths[socketID]] &&
        userCounts[roomPaths[socketID]] >= umax
      ) {
        client.write('<FULL />\0');
        return;
      }

      userCounts[roomPaths[socketID]] =
        (userCounts[roomPaths[socketID]] || 0) + 1;

      userSockets[roomPaths[socketID]] = userSockets[roomPaths[socketID]] || {};
      userSockets[roomPaths[socketID]][clientIDs[socketID]] = client;

      userAttributes[roomPaths[socketID]] =
        userAttributes[roomPaths[socketID]] || {};

      if (Object.entries(userAttributes[roomPaths[socketID]]).length) {
        client.write(
          `<ROOM>${Object.values(userAttributes[roomPaths[socketID]])
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

      userAttributes[roomPaths[socketID]][clientIDs[socketID]] = attributes;

      userAttributes[roomPaths[socketID]][clientIDs[socketID]].id =
        clientIDs[socketID];

      if ('trip' in attributes) {
        userAttributes[roomPaths[socketID]][
          clientIDs[socketID]
        ].trip = tripcode(attributes.trip);
      }

      userAttributes[roomPaths[socketID]][clientIDs[socketID]].ihash = tripcode(
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
          const childRoomPath = `${roomPaths[socketID]}/${i}`;

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

        sendToRoomUsers[socketID](`<ENTER id="${clientIDs[socketID]}" />\0`);
      } else {
        sendToRoomUsers[socketID](
          `<ENTER${RECOGNIZED_ATTRIBUTES.ENTER.map((name) =>
            attributes[name] ? ` ${name}="${attributes[name]}"` : '',
          ).join('')} />\0`,
        );
      }

      sendToRoomUsers[socketID](
        `<COUNT c="${userCounts[roomPaths[socketID]]}" n="${
          roomNames[socketID]
        }" />\0`,
      );

      if (userSockets[parentRoomPaths[socketID]]) {
        sendToRoomUsers[socketID](
          `<COUNT><ROOM c="${userCounts[roomPaths[socketID]]}" n="${
            roomNames[socketID]
          }" /></COUNT>\0`,
          userSockets[parentRoomPaths[socketID]],
        );
      }
    },
    '<EXIT>': (client, socketID) => {
      if (!roomPaths[socketID]) {
        client.write(`<EXIT id="${clientIDs[socketID]}" />\0`);
        return;
      }

      userCounts[roomPaths[socketID]] -= 1;
      delete userAttributes[roomPaths[socketID]][clientIDs[socketID]];

      sendToRoomUsers[socketID](`<EXIT id="${clientIDs[socketID]}" />\0`);

      sendToRoomUsers[socketID](
        `<COUNT c="${userCounts[roomPaths[socketID]]}" n="${
          roomNames[socketID]
        }" />\0`,
      );

      delete userSockets[roomPaths[socketID]][clientIDs[socketID]];

      if (userSockets[parentRoomPaths[socketID]]) {
        sendToRoomUsers[socketID](
          `<COUNT><ROOM c="${userCounts[roomPaths[socketID]]}" n="${
            roomNames[socketID]
          }" /></COUNT>\0`,
          userSockets[parentRoomPaths[socketID]],
        );
      }

      delete roomPaths[socketID];
      delete parentRoomPaths[socketID];
      delete roomNames[socketID];
    },
    default: (client, socketID, attributes, rootTagName) => {
      if (RECOGNIZED_ATTRIBUTES[rootTagName]) {
        if (rootTagName === 'SET') {
          Object.assign(
            userAttributes[roomPaths[socketID]][clientIDs[socketID]],
            attributes,
          );
        }

        sendToRoomUsers[socketID](
          `<${rootTagName}${RECOGNIZED_ATTRIBUTES[rootTagName]
            .map((name) =>
              name === 'id'
                ? ` id="${clientIDs[socketID]}"`
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
  },
  (client, socketID) => {
    if (!clientIDs[socketID]) return;

    freeIDs.unshift(clientIDs[socketID]);
    delete loggedIDs[clientIDs[socketID]];

    if (!roomPaths[socketID]) return;

    userCounts[roomPaths[socketID]] -= 1;
    delete userSockets[roomPaths[socketID]][clientIDs[socketID]];
    delete userAttributes[roomPaths[socketID]][clientIDs[socketID]];

    sendToRoomUsers[socketID](`<EXIT id="${clientIDs[socketID]}" />\0`);

    sendToRoomUsers[socketID](
      `<COUNT c="${userCounts[roomPaths[socketID]]}" n="${
        roomNames[socketID]
      }" />\0`,
    );

    if (userSockets[parentRoomPaths[socketID]]) {
      sendToRoomUsers[socketID](
        `<COUNT><ROOM c="${userCounts[roomPaths[socketID]]}" n="${
          roomNames[socketID]
        }" /></COUNT>\0`,
        userSockets[parentRoomPaths[socketID]],
      );
    }

    delete roomPaths[socketID];
    delete parentRoomPaths[socketID];
    delete roomNames[socketID];
  },
);
