import xml2js from 'xml2js';

import XMLSocket from '../lib/XMLSocket.mjs';

const HOST = 'localhost';
const PORT = 9095;

const sleep = (seconds) =>
  new Promise((resolve) => setTimeout(resolve, seconds * 1e3));

const client = new XMLSocket(
  {
    host: HOST,
    port: PORT,
  },
  () => {
    (async () => {
      client.write('MojaChat\0');

      await sleep(1);

      client.write(
        '<ENTER room="/COOL8099/1" umax="0" type="uchujin6" name="Momabot/2.1" trip="騨ﾚNWKJ諤" x="360" y="275" r="100" g="100" b="40" scl="100" stat="通常" />\0',
      );

      await sleep(1);

      for (let i = 0; i < 1000; i += 1) {
        client.write(`<COM  cmt="${i}" cnt="${i}" />\0`);
        await sleep(0.1);
      }
    })();
  },
);

client.on('data', (data) => {
  const lines = String(data)
    .replace(/\0$/, '')
    .split('\0');

  console.log(lines);

  lines.forEach((line) => {
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
