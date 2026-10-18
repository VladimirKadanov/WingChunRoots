// What a service knows about the request besides the principal (plan §6.6): the request id and
// the ip_hmac for the audit log. Never the IP address itself (plan §6.4).

import { requestIdFrom } from '../audit';
import { clientIp, ipHmac } from '../auth/ip';

export interface RequestMeta {
  requestId: string;
  ipHmac: string | null;
}

export function requestMeta(headers: Headers): RequestMeta {
  return { requestId: requestIdFrom(headers), ipHmac: ipHmac(clientIp(headers)) };
}
