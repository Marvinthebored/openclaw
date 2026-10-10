import fs from 'node:fs';
import path from 'node:path';

export default {
  id: 'sidebar-native-proof',
  name: 'Sidebar native proof',
  register(api) {
    const receiptPath = path.join(process.env.OPENCLAW_STATE_DIR, 'sidebar-action-receipt.json');
    let invocationCount = 0; const effects=[];
    api.registerGatewayMethod("sidebarproof.status", ({respond}) => respond(true,{invocationCount,effects}), {scope:"operator.read"});
    api.registerGatewayMethod('sidebarproof.record', ({ params, client, respond }) => {
      if (params?.marker !== 'native-production-bridge' || client?.connect?.role !== 'operator') {
        respond(false, undefined, { code: 'INVALID_REQUEST', message: 'Expected native proof operator action.' });
        return;
      }
      const receipt = {
        marker: params.marker,
        caseLabel: params.caseLabel,
        invocationCount: ++invocationCount,
        role: client.connect.role,
        clientId: client.connect.client.id,
        connectionId: client.connId,
        scopes: client.connect.scopes,
        at: new Date().toISOString(),
      };
      effects.push(receipt);
      fs.writeFileSync(receiptPath + '.tmp', JSON.stringify({invocationCount,effects}, null, 2));
      fs.renameSync(receiptPath + '.tmp', receiptPath);
      respond(true, receipt);
    }, { scope: 'operator.write' });
  },
};
