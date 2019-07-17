import xml2js from 'xml2js';

import XMLSocket from '../lib/XMLSocket.mjs';

const HOST = 'monachat.dyndns.org';
const PORT = 9090;

const sleep = (seconds) =>
  new Promise((resolve) => setTimeout(resolve, seconds * 1000));

let t;

(function loop() {
  const client = new XMLSocket(
    {
      host: HOST,
      port: PORT,
    },
    () => {
      (async () => {
        client.write('MojaChat\0');

        await sleep(0.5);

        client.write('<unko/>\0');

        /*

        client.write(
          '<ENTER room="/MONA8091/1" umax="0" type="tibisii" name="Momabot/2.1" trip="騨ﾚNWKJ諤" x="360" y="275" r="100" g="100" b="40" scl="100" stat="通常" />\0',
        );

        await sleep(0.2);

        client.write(`<SET stat="${'あ'.repeat(24)}" />\0`); */
      })();
    },
  );

  client.on('error', () => {});

  client.on('end', () => {
    /*    setTimeout(() => {
      loop();
    }, 100); */
  });

  client.on('data', (data) => {
    const lines = String(data)
      .replace(/\0$/, '')
      .split('\0');

    console.log(lines);

    lines.forEach((line) => {
      if (line.startsWith('+')) {
        console.log(Date.now() - t);
        t = Date.now();
      }

      xml2js.parseString(line, (error, object) => {
        if (error) {
          return;
        }

        const rootTagName = Object.keys(object)[0];
        const attributes = object[rootTagName].$ || {};

        switch (rootTagName) {
          case 'COM': {
            const { cmt } = attributes;

            switch (cmt) {
              case 'unko': {
                client.write('unko\0');
              }
              // no default
            }
          }
          // no default
        }
      });
    });
  });
})();
