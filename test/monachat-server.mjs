import path from 'path';

import tripcode2ch from '2ch-trip';
import xml2js from 'xml2js';

import XMLSocket from '../lib/XMLSocket.mjs';

const tripcode = (password) =>
  password === '' ? 'jPpg5.obl6' : tripcode2ch(`#${password}`).slice(1);

const HOST = 'localhost';
const PORT = 9095;

const MAX_NUMBER_OF_CONNECTIONS_PER_HOST = 1;

const TIMEOUT = 30;

// const MAX_NUMBER_OF_ROOMS = 100;

const MAX_NAME_LENGTH = 23;

const MAX_TYPE_LENGTH = 23;

const MAX_MESSAGE_LENGTH = 50;

const MIN_MESSAGE_INTERVAL = 2;
const MAX_MESSAGE_INTERVAL_EXCEEDED_COUNT = 10;

const MAX_STATUS_LENGTH = 23;

const RECOGNIZED_ATTRIBUTES = {
  ENTER: [
    'r',
    'name',
    'id',
    'trip',
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

const temporarilyBannedHosts = {};
const banTime = {};

const connectionCounts = {};

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
    if (
      temporarilyBannedHosts[client.remoteAddress] ||
      (connectionCounts[client.remoteAddress] &&
        connectionCounts[client.remoteAddress] >=
          MAX_NUMBER_OF_CONNECTIONS_PER_HOST)
    ) {
      client.end();
      return;
    }

    connectionCounts[client.remoteAddress] =
      (connectionCounts[client.remoteAddress] || 0) + 1;

    let clientID;

    let timeoutTimer;

    let roomPath;
    let parentRoomPath;
    let roomName;

    let messageIntervalTimer;
    let messageIntervalExceededCount = 0;

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

    const setTimeoutTimer = () =>
      setTimeout(() => {
        send('Connection timeout..');
        client.end();
      }, TIMEOUT * 1e3);

    const temporarilyBan = () => {
      temporarilyBannedHosts[client.remoteAddress] = true;

      banTime[client.remoteAddress] = !banTime[client.remoteAddress]
        ? 10
        : banTime[client.remoteAddress] * 5;

      setTimeout(() => {
        delete temporarilyBannedHosts[client.remoteAddress];
      }, banTime[client.remoteAddress] * 1e3);
    };

    const onEnd = () => {
      connectionCounts[client.remoteAddress] -= 1;

      if (clientID) {
        freeIDs.unshift(clientID);
        delete loggedIDs[clientID];

        if (roomPath != null) {
          onExit();
        }
      }
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

    client.on('data', (bytes) => {
      const string = String(bytes);

      if (!string.endsWith('\0')) {
        client.end();
        return;
      }

      const lines = string.replace(/\0$/, '').split('\0');
      console.log(lines);

      class StopIteration extends Error {}

      try {
        lines.forEach((line) => {
          if (!clientID && line === 'MojaChat') {
            if (freeIDs.length) {
              clientID = freeIDs.pop();
            } else {
              maxID += 1;
              clientID = maxID;
            }

            loggedIDs[clientID] = (loggedIDs[clientID] || 0) + 1;

            timeoutTimer = setTimeoutTimer();

            send(`+connect id=${clientID}`);
            send(`<CONNECT id="${clientID}" />`);

            return;
          }

          xml2js.parseString(line, (error, object) => {
            if (error || !object) {
              client.end();
              throw new StopIteration();
            }

            const rootTagName = Object.keys(object)[0];

            if (!clientID) {
              if (rootTagName === 'policy-file-request') {
                send(
                  '<cross-domain-policy><allow-access-from domain="monachat.dyndns.org" to-ports="9090-9100" /><allow-access-from domain="monachat.net" to-ports="9090-9100" /><allow-access-from domain="chat.moja.jp" to-ports="9090-9100" /><allow-access-from domain="cool.moja.jp" to-ports="9090-9100" /></cross-domain-policy>',
                );

                send('Connection timeout..');
              }

              client.end();
              throw new StopIteration();
            }

            const attributes = object[rootTagName].$ || {};
            attributes.id = clientID;

            clearTimeout(timeoutTimer);
            timeoutTimer = setTimeoutTimer();

            switch (rootTagName) {
              case 'NOP': {
                return;
              }
              case 'ENTER': {
                if (
                  (attributes.name &&
                    attributes.name.length > MAX_NAME_LENGTH) ||
                  (attributes.type && attributes.type.length > MAX_TYPE_LENGTH)
                ) {
                  client.end();
                  throw new StopIteration();
                }

                roomPath = path.resolve('/', attributes.room || '');

                const umax = Number(attributes.umax);

                if (
                  umax &&
                  userCounts[roomPath] &&
                  userCounts[roomPath] >= umax
                ) {
                  send('<FULL />');
                  roomPath = undefined;
                  return;
                }

                parentRoomPath = path.dirname(roomPath);
                roomName = path.basename(roomPath);

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
                            .map((key) =>
                              value[key] ? ` ${key}="${value[key]}"` : '',
                            )
                            .join('')} />`,
                      )
                      .join('')}</ROOM>`,
                  );
                } else {
                  send('<ROOM />');
                }

                userAttributes[roomPath][clientID] = attributes;

                if ('trip' in attributes) {
                  userAttributes[roomPath][clientID].trip = tripcode(
                    attributes.trip,
                  );
                }

                userAttributes[roomPath][clientID].ihash = tripcode(
                  client.remoteAddress,
                );

                if (attributes.attrib === 'no') {
                  if ('name' in attributes) {
                    send(
                      `<UINFO${['name', 'trip', 'id']
                        .map((key) =>
                          attributes[key] ? ` ${key}="${attributes[key]}"` : '',
                        )
                        .join('')} />`,
                    );
                  }

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

                      if (!matches) {
                        return;
                      }

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
                    `<ENTER${RECOGNIZED_ATTRIBUTES.ENTER.map((key) =>
                      attributes[key] ? ` ${key}="${attributes[key]}"` : '',
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
              case 'SET': {
                if (
                  attributes.stat &&
                  attributes.stat.length > MAX_STATUS_LENGTH
                ) {
                  client.end();
                  temporarilyBan();
                  throw new StopIteration();
                }

                Object.assign(
                  userAttributes[roomPath][clientID],
                  Object.fromEntries(
                    Object.entries(attributes).filter(([key]) =>
                      RECOGNIZED_ATTRIBUTES[rootTagName].includes(key),
                    ),
                  ),
                );
              }
              // fallthrough
              case 'COM': {
                if (messageIntervalTimer) {
                  messageIntervalExceededCount += 1;
                  clearTimeout(messageIntervalTimer);

                  if (
                    messageIntervalExceededCount >=
                    MAX_MESSAGE_INTERVAL_EXCEEDED_COUNT
                  ) {
                    client.end();
                    temporarilyBan();
                    throw new StopIteration();
                  }
                }

                if (
                  attributes.cmt &&
                  attributes.cmt.length > MAX_MESSAGE_LENGTH
                ) {
                  client.end();
                  throw new StopIteration();
                }

                messageIntervalTimer = setTimeout(() => {
                  messageIntervalTimer = undefined;
                }, MIN_MESSAGE_INTERVAL * 1e3);
              }
              // fallthrough
              default: {
                if (!RECOGNIZED_ATTRIBUTES[rootTagName]) {
                  client.end();
                  temporarilyBan();
                  throw new StopIteration();
                }

                sendToRoomUsers(
                  `<${rootTagName}${RECOGNIZED_ATTRIBUTES[rootTagName]
                    .map((key) =>
                      attributes[key] ? ` ${key}="${attributes[key]}"` : '',
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
