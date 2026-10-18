// What a service knows about the request besides the principal (plan §6.6): the request id and
// the ip_hmac for the audit log. Never the IP address itself (plan §6.4).

import { requestIdFrom } from '../audit';
import { clientIp, ipHmac } from '../auth/ip';
import { testFaultToken } from '../faults';

export interface RequestMeta {
  requestId: string;
  ipHmac: string | null;
  /** M04: the test fault token of this request (src/server/faults.ts); null unless the switch is on. */
  testFault?: string | null;
}

export function requestMeta(headers: Headers): RequestMeta {
  return { requestId: requestIdFrom(headers), ipHmac: ipHmac(clientIp(headers)), testFault: testFaultToken(headers) };
}
