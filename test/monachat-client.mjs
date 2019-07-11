import XMLSocket from '../lib/XMLSocket.mjs';

const client = new XMLSocket({ port: 9095 }, () => {
  client.write('MojaChat\0');

  client.write('<policy-file-request/>\0');

  client.write(
    '<ENTER room="/MONA8094" name="名無しさん" trip="" attrib="no"/>\0',
  );

  client.write('<EXIT />\0');

  client.write(
    '<ENTER room="/MONA8094/1" umax="0" type="tibisii" name="Momabot/2.1" trip="騨ﾚNWKJ諤" x="360" y="275" r="100" g="100" b="40" scl="100" stat="通常" />\0',
  );
});

client.on('data', (data) => {
  console.log(
    String(data)
      .replace(/\0$/, '')
      .split('\0')
      .join('\n'),
  );
});
