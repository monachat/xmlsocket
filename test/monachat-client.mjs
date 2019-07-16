import xml2js from 'xml2js';

import XMLSocket from '../lib/XMLSocket.mjs';

const PORT = 9095;

const client = new XMLSocket(
  {
    port: PORT,
  },
  () => {
    client.write('MojaChat\0');

    client.write(
      '<ENTER room="/MONA8094/1" umax="0" type="tibisii" name="Momabot/2.1" trip="騨ﾚNWKJ諤" x="360" y="275" r="100" g="100" b="40" scl="100" stat="通常" />\0',
    );

    client.write('\0\0\0\0');
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
